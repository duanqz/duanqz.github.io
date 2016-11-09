---
layout: post
category: Android系统原理
title: 电量统计(1)-原理
tagline: batterystats
tags: 日志分析
---

说明：本文的代码以**android-5.1.1_r8**为蓝本，代码的在线网址是<{{ site.android_source }}/>

# 1. 概要

我们平常说的手机耗电量，一般涵盖两个方面：硬件层面的功耗和软件层面的电量。

本文介绍的电量统计的原理，并不涉及到硬件层面的功耗设计，仅从软件层面围绕以下几个问题进行分析：

> Android如何启动电量统计服务？<br/>
> 电量统计涉及到哪一些硬件模块？<br/>
> 如何计算一个应用程序的耗电量？<br/>
> 电量统计需要完成哪些具体工作？

手机有很多硬件模块：CPU，蓝牙，GPS，显示屏，Wifi，射频(Cellular Radio)等，在手机使用过程中，这些硬件模块可能处于不同的状态，譬如Wifi打开或关闭，屏幕是亮还是暗，CPU运行或休眠。
硬件模块在不同的状态下的耗电量是不同的。Android在进行电量统计时，并不是采用直接记录电流消耗量的方式，而是跟踪硬件模块在不同状态下的使用时间，收集一些可用信息，用来近似的计算出电池消耗量。

从用户使用层面来看，Android需要统计出应用程序的耗电量。应用程序的耗电量由很多部分组成，可能使用了GPS，蓝牙等模块，可能应用程序要求长时间亮屏(譬如游戏、视频类应用)。
一个应用程序的电量统计，可以采用累计应用程序使用所有硬件模块时间这种方式近似计算出来。

举一个例子，假定某个APK的使用了GPS，使用时间用 *t* 表示。GPS模块单位时间的耗电量用 *w* 表示，那么，这个APK使用GPS的耗电量就可以按照如下方式计算：

    耗电量 = 单位时间耗电量(w) × 使用时间(t)

Android框架层通过一个名为`batterystats`的系统服务，实现了电量统计的功能。`batterystats`获取电量的使用信息有两种方式：

- **被动(push)**：有些硬件模块(wifi, 蓝牙)在发生状态改变时，通知`batterystats`记录状态变更的时间点

- **主动(pull)**：有些硬件模块(cpu)需要`batterystats`主动记录时间点，譬如记录Activity的启动和终止时间，就能计算出Activity使用CPU的时间

电量统计服务的代码逻辑涉及到以下android源码：

- [frameworks/base/services/java/com/android/server/SystemServer.java]({{ site.android_source }}/platform/frameworks/base/+/android-5.1.1_r8/services/java/com/android/server/SystemServer.java#314)
- [frameworks/base/services/core/java/com/android/server/am/ActivityManagerService.java]({{ site.android_source }}/platform/frameworks/base/+/android-5.1.1_r8/services/core/java/com/android/server/am/ActivityManagerService.java#2162)
- [frameworks/base/services/core/java/com/android/server/am/BatteryStatsService.java]({{ site.android_source }}/platform/frameworks/base/+/android-5.1.1_r8/services/core/java/com/android/server/am/BatteryStatsService.java)
- [frameworks/base/core/java/android/os/BatteryStats.java]({{ site.android_source }}/platform/frameworks/base/+/android-5.1.1_r8/core/java/android/os/BatteryStats.java)
- [frameworks/base/core/java/com/android/internal/os/BatteryStatsImpl.java]({{ site.android_source }}/platform/frameworks/base/+/android-5.1.1_r8/core/java/com/android/internal/os/BatteryStatsImpl.java)
- [frameworks/base/core/java/com/android/internal/os/BatteryStatsHelper.java]({{ site.android_source }}/platform/frameworks/base/+/android-5.1.1_r8/core/java/com/android/internal/os/BatteryStatsHelper.java)
- [frameworks/base/core/res/res/xml/power_profile.xml]({{ site.android_source }}/platform/frameworks/base/+/android-5.1.1_r8/core/res/res/xml/power_profile.xml)

为了描述的简便，后文仅以**短类名.方法名()**表示代码片段所在的位置。

# 2. 电量统计服务的启动过程

电量统计服务是一个系统服务，名字为`batterystats`，在Android系统启动的时候，这个服务就会被启动，其启动时序如下图所示：

![电量统计服务启动时序](/assets/images/batterystats/1-batterystats-booting-sequence-diagram.png)

电量统计服务是间接由ActivityManagerService(后文简称AMS)来启动，AMS是Android系统最为基础的服务，进入Android系统后，最优先启动的，就是这类服务。

- 在**SystemServer.startBootstrapServices()**这个方法中，将ActivityManagerService.Lifecycle传入**SystemServiceManager.startService()**这个方法，就实现了AMS的初始化。

  注：Android提供了系统服务的基础类**SystemService**，子类通过实现系统回调函数，来完成具体系统服务的生命周期。ActivityManagerService.Lifecycle就是**SystemService**的子类。

{% highlight java %}
private void startBootstrapServices() {
    ...
    mActivityManagerService = mSystemServiceManager.startService(
            ActivityManagerService.Lifecycle.class).getService();
    mActivityManagerService.setSystemServiceManager(mSystemServiceManager);
    ...
}
{% endhighlight %}

- 在**SystemServiceManager.startService()**这个方法中，利用反射构造出一个新的实例，当ActivityManagerService.Lifecycle作为参数传入的时候，就完成了ActivityManagerService的初始化，注册和启动的工作。

{% highlight java %}
public <T extends SystemService> T startService(Class<T> serviceClass) {
    ...
    Constructor<T> constructor = serviceClass.getConstructor(Context.class);
    service = constructor.newInstance(mContext);
    ...
    mServices.add(service); // 注册新的系统服务
    ...
    service.onStart();      // 启动新的系统服务
    ...
}
{% endhighlight %}

- 在**ActivityManagerService.start()**方法中，伴随着ActivityManagerService启动的，BatteryStatService通过publish方法，将自己注册到系统服务中。

{% highlight java %}
private void start() {
    ...
    mBatteryStatsService.publish(mContext);
    ...
}
{% endhighlight %}

- 在**BatteryStatsService.publish()**方法中，将**BatteryStats.SERVICE_NAME**这个名字注册到系统服务中，这个名字实际上就是**batterystats**，
后续使用电量统计服务时，只需要通过这个名字向系统获取对应的服务就可以了。  

{% highlight java %}
public void publish(Context context) {
    ...
    ServiceManager.addService(BatteryStats.SERVICE_NAME, asBinder());
    mStats.setNumSpeedSteps(new PowerProfile(mContext).getNumSpeedSteps());
    mStats.setRadioScanningTimeout(mContext.getResources().getInteger(
            com.android.internal.R.integer.config_radioScanningTimeout)
            * 1000L);
}
{% endhighlight %}

- **mStats**是BatteryStatsImpl类的一个对象，从类名可以看出BatteryStatsImpl是BatteryStats的实现类，它描述了所有与电量消耗有关的信息，其实现逻辑，后文再作具体分析。

  这里新建了**PowerProfile**类，并调用了getNumSpeedSteps()方法， *NumSpeedSteps*描述的是CPU的运行频率，不同设备的CPU值可能不同。
  除了CPU的运行频率，还有很多其他与耗电量相关参数，都是因设备而异的，**PowerProfile**类就是专门描述这些参数的，通过解析[frameworks/base/core/res/res/xml/power_profile.xml]({{ site.android_source }}/platform/frameworks/base/+/android-5.1.1_r8/core/res/res/xml/power_profile.xml)
这个XML文件完成初始化。厂商需要根据硬件设备的实际情况，设置不同的参数，以下是Nexus 5(hammerhead)耗电参数配置的代码片段：

{% highlight xml %}
<device name="Android">
    <!-- All values are in mAh except as noted -->
    <item name="none">0</item>
    ...
    <item name="wifi.on">3.5</item>
    <item name="wifi.active">73.24</item>
    <item name="wifi.scan">75.48</item>
    ...
    <item name="battery.capacity">2300</item>
</device>
{% endhighlight %}

wifi.on, wifi.active, wifi.scan分别表示wifi模块在打开、工作和扫描时的单位时间的电流量，这个值的单位的mAh。其他一些参数可以参见：<https://source.android.com/devices/tech/power/index.html#power-values>

前面我们提到耗电量是通过计算：

    耗电量 = 单位时间的耗电量(w) × 使用时间(t) = 电压(U) × 单位时间电流量(I) × 使用时间(t)

在手机上电压一般是恒定的，所以，计算耗电量只需要知道单位时间电流量即可。有了power_profile.xml这个文件描述的单位时间电流量，再收集硬件模块在不同状态下的使用时间，就能够近似的计算出耗电量了。

**至此，我们分析了以下两个问题：**

- **Android如何启动电量统计服务？** Android系统启动 -> AMS启动和注册 -> batterystats启动和注册

- **Android如何计算耗电量？** 并不是直接跟踪电流消耗量，而是采用“单位时间电流量(I)×使用时间(t)”来做近似计算。不同硬件模块的单位时间电流量是需要厂商给定的。


# 3. 电量统计服务的工作过程

电量统计包含几个重要的功能：信息收集、信息存储和电量计算。

- 信息收集是指在什么时间点采用什么方式收集电量使用数据
- 信息存储按照什么格式存放，存放在什么位置
- 电量计算是指根据已经收集的信息，如何计算出不同应用、服务、进程等的电量使用情况

在具体介绍电量统计服务的工作过程之前，先上工作原理图一张：

<div align="center"><img src="/assets/images/batterystats/2-batterystats-working-process.png" alt="电量统计服的工作过程"/></div>

## 3.1 电量信息收集

`batterystats`有主动和被动收集电量使用信息的方式，收集的信息基本都包含硬件模块的状态和被使用的时间两个维度。为什么仅仅是收集不同硬件模块的使用时间呢？
前面我们说过，手机电压通常是恒定的，耗电量是通过 “单位时间电流量(I) × 使用时间(t)” 来计算，而单位时间电流量是由厂商给定的，定义在power_profile.xml中，
所以，只需要收集不同硬件模块的使用时间，就可以近似的计算出耗电量了

收集信息被组织起来，在内存中的数据结构是由[**BatteryStats**]({{ site.android_source }}/platform/frameworks/base/+/android-5.1.1_r8/core/java/android/os/BatteryStats.java)类描述的。
为了能够从不同维度统计耗电量，这个数据结构设计得比较复杂，我们不在这里展开讨论，仅通过一个收集应用程序前台运行时间的例子，来说明信息收集过程。

记录应用程序中所有Activity从显示状态(Resumed)到消失状态(Paused)的时间，就能够统计应用程序的前台运行时间。Activity状态的切换是由AMS掌控的，因此AMS需要将Activity的状态信息通知给`batterystats`服务。

- 当Activity要切换到显示状态(Resumed)时，会调用**ActivityStackSupervisor.resumeTopActivitiesLocked()**方法，
  接下来会调用**ActivityStack.resumeTopActivityInnerLocked()**方法来完成Activity的状态切换，在完成状态切换后，
  会调用**ActivityStackSupervisor.reportResumedActivityLocked()**方法，从这里开始，就开始通报了：“本Activity已经进入了显示状态”。

{% highlight java %}
boolean reportResumedActivityLocked(ActivityRecord r) {
    final ActivityStack stack = r.task.stack;
    if (isFrontStack(stack)) {
        mService.updateUsageStats(r, true);
    }
    ...
}
{% endhighlight %}

- 在**ActivityManagerService.updateUsageStats()**方法中，首先会获取一个统计信息的实例**BatteryStatsImpl**，它是**BatteryStats**的子类，描述了所有的统计信息；
  然后，根据是否处于resumed的状态，作出Resumed或Paused的通知。

{% highlight java %}
void updateUsageStats(ActivityRecord component, boolean resumed) {
    ...
    final BatteryStatsImpl stats = mBatteryStatsService.getActiveStatistics();
    if (resumed) {
        ...
        stats.noteActivityResumedLocked(component.app.uid);
    } else {
        ....
        stats.noteActivityPausedLocked(component.app.uid);
    }
}
{% endhighlight %}

- 在**BatteryStatsImpl.noteActivityResumedLocked()**方法中，会启动一个计时器(StopwatchTimer)，记录下了启动时间(uptime)

{% highlight java %}
public void noteActivityResumedLocked(long elapsedRealtimeMs) {
    createForegroundActivityTimerLocked().startRunningLocked(elapsedRealtimeMs);
}
{% endhighlight %}

- 在**BatteryStatsImpl.noteActivityPausedLocked()**方法中，会停止之前启动的计时器(StopwatchTimer)，并计算出使用时间。

{% highlight java %}
public void noteActivityPausedLocked(long elapsedRealtimeMs) {
    if (mForegroundActivityTimer != null) {
        mForegroundActivityTimer.stopRunningLocked(elapsedRealtimeMs);
    }
}
{% endhighlight %}

除了应用程序前台运行时间，还有很多信息是`batterystats`服务关注的，包括WakeLock、Sendor、Wifi、Audio、Video等，这些信息的采集方式与上述过程雷同，都会经过以下步骤：

- 由相应的模块发起状态变更的通知
- BatteryStats使用定时器记录起止时间

应用程序可能会使用多个硬件模块，所以，耗电信息收集的策略也被设计得比较复杂，譬如，要使用到很多计时器，就设计出了“计时器池”来提高资源利用率。


## 3.2 电量信息存储

收集到的电量信息，在内存中是由**BatteryStats**这个类来描述的，Android支持历史电量信息的显示的，如果重新启动Android，那内存中的数据就丢失了，
所以需要把这些信息存储到磁盘上，磁盘上的 */data/system/batterystats.bin* 文件中就是电量信息的序列化数据。

`batterystats`服务启动时，会从 *batterystats.bin* 这个文件中读取数据，来初始化**BatteryStats**这个数据结构。

- **BatteryStatsService()**构造函数中，初始化了**BatteryStats**的子类**BatteryStatsImpl**

{% highlight java %}
BatteryStatsService(File systemDir, Handler handler) {
    mStats = new BatteryStatsImpl(systemDir, handler);
}
{% endhighlight %}

- **BatteryStatsImpl()**构造函数中，一开始就会新建一个文件batterystats.bin，传入参数systemDir,就是“/data/system”。
  这个时候，还并没有从文件中读取数据来填充内存。

{% highlight java %}
public BatteryStatsImpl(File systemDir, Handler handler) {
    if (systemDir != null) {
        mFile = new JournaledFile(new File(systemDir, "batterystats.bin"),
                new File(systemDir, "batterystats.bin.tmp"));
    } else {
        mFile = null;
    }
    ...
}
{% endhighlight %}

- **ActivityManagerService()**构造函数中,有初始化电量统计服务的逻辑，会调用到**BatteryStatsImpl.readLocked()**方法，
   这个方法里面完成了将磁盘数据反序列化到内存。

{% highlight java %}
public ActivityManagerService(Context systemContext) {
    ...
    File systemDir = new File(dataDir, "system");
    systemDir.mkdirs();
    mBatteryStatsService = new BatteryStatsService(systemDir, mHandler);
    mBatteryStatsService.getActiveStatistics().readLocked();
    ...
}
{% endhighlight %}

有数据的读取，就有数据的写入，通过调用**BatteryStatsImpl.writeLocked()**方法，就将数据写回到了 *batterystats.bin* 这个文件。
**ActivityManagerService.updateCpuStatsNow()**方法会触发写 *batterystats.bin* 的操作，而这个方法，在更新电量使用信息的时候就会被调用到。
所以，在手机使用的过程中，收集到的电量信息，就会被当作历史信息，不定时的写入到磁盘保存下来，下次`batterystats`启动时，又会被用到。

## 3.3 电量计算

**BatteryStatsHelper.refreshStats()**承载了电量计算的全部过程，在需要显示电量统计信息的地方，就可以通过**BatteryStatsHelper**这个类，来获取统计完成的电量信息。
Setting.apk就引用了这个类。电量计算大体可以分为两块：

- **AppUsage**：应用程序耗电量计算，是指每一个应用程序使用硬件模块所产生的耗电量

- **MiscUsage**：其他杂项耗电量计算，所谓杂项，其实就是用户比较关心的一大类，包括：待机的耗电量、亮屏的耗电量、通话的耗电量、Wifi的耗电量等

### 3.3.1 AppUsage

在**BatteryStatsHelper.processAppUsage()**这个方法中，实现了应用程序的电量计算(实际上统计的粒度是uid，不同的apk可以运行在同一个uid)。

- 首先，有一个统计时间段的概念，是通过统计类型**mStatsType**这个变量来表示的，有以下可选值：

{% highlight java %}
// 统计从上一次充电以来至现在的耗电量
public static final int STATS_SINCE_CHARGED = 0;

// 统计系统启动以来到现在的耗电量
public static final int STATS_CURRENT = 1;

// 统计从上一次拔掉USB线以来到现在的耗电量
public static final int STATS_SINCE_UNPLUGGED = 2;
{% endhighlight %}


- 然后，我们来看一下这个函数体，它实现的是与APP耗电量计算的逻辑。

{% highlight java %}
private void processAppUsage(SparseArray<UserHandle> asUsers) {
    // 根据power_profile.xml文件中的单位时间电流量定义，初始化一些计算参数
    final int which = mStatsType;
    final int speedSteps = mPowerProfile.getNumSpeedSteps();
    final double[] powerCpuNormal = new double[speedSteps];
    final long[] cpuSpeedStepTimes = new long[speedSteps];
    for (int p = 0; p < speedSteps; p++) {
        powerCpuNormal[p] = mPowerProfile.getAveragePower(PowerProfile.POWER_CPU_ACTIVE, p);
    }
    final double mobilePowerPerPacket = getMobilePowerPerPacket();
    final double mobilePowerPerMs = getMobilePowerPerMs();
    final double wifiPowerPerPacket = getWifiPowerPerPacket();
    ...

    // 对一个UID进行电量统计， UID几乎可以等同于一个应用程序
    SparseArray<? extends Uid> uidStats = mStats.getUidStats();
    final int NU = uidStats.size();
    for (int iu = 0; iu < NU; iu++) {
        // 1. 计算每一个UID中所有进程在CPU运算时的耗电量，比如应用程序在前台显示，或者后台有服务在占用CPU
        //    CPU有不同的运行频率，每一个频率和该频率下的单位时间电流都在power_profile.xml中有定义  

        // 2. 计算Wakelock占用的耗电量，Wakelock被占用，意味着CPU处于唤醒状态
        //    在有些时候，并不需要进行CPU运算，但CPU仍处于唤醒状态

        // 3. 计算使用数据网络的耗电量
        //    应用程序使用数据网络上网时的耗电量，完成这部分通信的射频模块(radio)

        // 4. 计算使用wifi的耗电量
        //    wifi的使用又可以分为两个情况：扫描可用wifi(SCAN)和进行数据传输(RUNNING)，
        //    这两种情况下的单位时间电流量是不同的

        // 5. 计算使用传感器的耗电量
        //    GPS使用的耗电量计算也被包含在这里
    }
}
{% endhighlight %}

- 最后，我们来总结一下应用程序的电量计算过程。Android通过一个名为**BatteryStats.Uid**的数据结构来维护一个应用程序的电量统计信息。
  这个数据结构中，又包含很多子结构：

  - Proc：表示属于Uid的进程，一个Uid中可能会有多个进程，每个进程都有CPU占用时间
  - WakeLock：表示Uid持有的WakeLock锁的电量统计，一个Uid也可能会持有多个锁
  - Mobile Raido：表示Uid使用数据流量的电量统计，譬如3G流量、4G流量
  - Wifi：表示Uid使用wifi的电量统计
  - Sendor：表示Uid使用传感器的电量统计  

<div align="center"><img src="/assets/images/batterystats/3-batterystats-app-usage.png" alt="应用程序电量计算过程"/></div>

  Android会对每一个Uid进行电量计算，每次计算都会涉及到以上五个维度，每一个维度的计算**几乎**都要用到硬件模块在不同状态下单位时间的电流量，以及硬件模块在当前Uid下的使用时间。

  注：这里说的**几乎**，是指还有一些例外情况，在计算使用数据网络的耗电量时，也可能会通过传输的数据包来计算耗电量。从这里，我们也可以看到电量计算是由一套复杂的策略决定的。


### 3.3.1 MiscUsage

在**BatteryStatsHelper.processMiscUsage()**这个方法中，实现了其他一些杂项的电量计算，函数的实现清晰了表明了意图。

{% highlight java %}
private void processMiscUsage() {
    addUserUsage();
    addPhoneUsage();
    addScreenUsage();
    addFlashlightUsage();
    addWiFiUsage();
    addBluetoothUsage();
    addIdleUsage(); // Not including cellular idle power
    // Don't compute radio usage if it's a wifi-only device
    if (!mWifiOnly) {
        addRadioUsage();
    }
}
{% endhighlight %}

**至此，我们进一步分析以下两个问题:**

- **如何计算一个应用程序的耗电量？** 收集硬件模块使用时间 -> 对每个应用程序进行归类计算

- **电量统计需要完成哪些具体工作？** 电量使用信息收集，存储和计算

本文分析了软件层面的电量统计原理，电量统计的结果，一般可以在“设置”这个程序的电池信息中可以看到。另一方面，Android提供的`dumpsys batterystats`功能，也能输出所有的电量统计信息，
在[电量统计(2)-日志](/2015-07-21-batterystats-part2)一文中，我们对Android的Log进行了详细的分析。
