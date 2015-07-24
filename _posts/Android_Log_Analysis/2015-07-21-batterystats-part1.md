---
layout: post
category: Android日志分析
title: 电量统计(1)-原理
tagline: batterystats
tags:  [dumpsys]
---
{% include JB/setup %}

说明：本文的代码以**android-5.1.1_r8**为蓝本，代码的在线网址是<https://android.googlesource.com/>

# 概要

我们平常说的手机耗电量，一般涵盖两个方面：硬件层面的功耗和软件层面的电量。

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

- [frameworks/base/services/java/com/android/server/SystemServer.java](https://android.googlesource.com/platform/frameworks/base/+/android-5.1.1_r8/services/java/com/android/server/SystemServer.java#314)
- [frameworks/base/services/core/java/com/android/server/am/ActivityManagerService.java](https://android.googlesource.com/platform/frameworks/base/+/android-5.1.1_r8/services/core/java/com/android/server/am/ActivityManagerService.java#2162)
- [frameworks/base/services/core/java/com/android/server/am/BatteryStatsService.java](https://android.googlesource.com/platform/frameworks/base/+/android-5.1.1_r8/services/core/java/com/android/server/am/BatteryStatsService.java)
- [frameworks/base/core/java/android/os/BatteryStats.java](https://android.googlesource.com/platform/frameworks/base/+/android-5.1.1_r8/core/java/android/os/BatteryStats.java)
- [frameworks/base/core/java/com/android/internal/os/BatteryStatsImpl.java](https://android.googlesource.com/platform/frameworks/base/+/android-5.1.1_r8/core/java/com/android/internal/os/BatteryStatsImpl.java)

为了描述的简便，后文仅以**短类名.方法名()**表示代码片段所在的位置。

# 电量统计服务的启动过程

电量统计服务是一个系统服务，名字为`batterystats`，在Android系统启动的时候，这个服务就会被启动，其启动工程如下图所示：

![电量统计服务启动时序]()

- 在**SystemServer.startBootstrapServices()**这个方法中，会启动Android系统最为基础的一些服务，ActivityManagerService就是在这个时候启动的。
  将ActivityManagerService.Lifecycle传入**SystemServiceManager.startService()**这个方法，就实现了ActivityManagerService的初始化。

  Android提供了系统服务的基础类**SystemService**，子类通过实现系统回调函数，来完成具体系统服务的生命周期。ActivityManagerService.Lifecycle就是**SystemService**的子类。

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
  除了CPU的运行频率，还有很多其他与耗电量相关参数，都是因设备而异的，**PowerProfile**类就是专门描述这些参数的，通过解析[frameworks/base/core/res/res/xml/power_profile.xml](https://android.googlesource.com/platform/frameworks/base/+/android-5.1.1_r8/core/res/res/xml/power_profile.xml)
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

wifi.on, wifi.active, wifi.scan分别表示wifi模块在打开、工作和扫描时的耗电量描述。这个值的单位的mAh，即单位时间的电流量。
前面我们提到耗电量是通过计算：

    耗电量 = 单位时间的耗电量(w) × 使用时间(t) = 电压(U) × 单位时间电流量(I) × 使用时间(t)

在手机上电压一般是恒定的，所以，计算耗电量只需要知道单位时间电流量即可。有了power_profile.xml这个文件描述的单位时间电流量，再收集硬件模块在不同状态下的使用时间，就能够近似的计算出耗电量了。

  
# 电量统计服务的工作过程

电量统计包含两个重要的功能：

- **信息收集** 

- **电量计算**

*/data/system/batterystats.bin*
