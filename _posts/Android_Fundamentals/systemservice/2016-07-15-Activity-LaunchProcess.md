---
layout: post
category: Android系统原理
title: ActivityManagerService的启动过程
tagline:
tags:  [Android系统服务]
---
{% include JB/setup %}

# 1. 概览

ActivitityManagerService(下文简称AMS)作为系统中最重要的服务，在开机时就会被启动，而且一直存在。
那么，Android是如何启动AMS，以及启动AMS时做了哪些初始化工作呢？

从进入Android系统进程(SystemServer)到用户所见的桌面(HomeActivity)，整个过程中，AMS都扮演着主角。
AMS就像一个大管家，总管着四大组件、进程调度、各类统计等信息。在AMS启动时，就表明了自己的身份：引导服务(BootstrapService)，意味着AMS是最重要的一类服务，大多数其他系统服务的启动都依赖于AMS。

本章分析的对象是AMS在系统进程中的启动过程，虽然仅仅是启动，涉及到的知识点已然非常多。

# 2. 在系统进程中启动AMS

AMS对象随系统进程启动而构建，随着系统进程退出而消亡，可以说，AMS与系统进程共存亡。
本章分析的内容是系统进程启动时与AMS相关的一些初始化操作，先上一张总的启动时序图:

<div align="center"><img src="/assets/images/systemservice/amslaunching/1-amslaunching-sequence-diagram.png" alt="Sequence Diagram"/></div>

可以分为三个步骤:

1. 初始化系统进程的运行环境;
2. 初始化AMS对象;
3. AMS对象启动的配套工作。

## 2.1 初始化系统进程的运行环境

[SystemServer]()是我们理解Android系统进程的入口，它的初始化是从Native层开始的:Zygote从Native层调用SystemServer的main()函数，便开始了SystemServer的初始化。初始化很重要的一个步骤就是创建系统进程的运行环境，即创建一个SystemContext，调用关系如下所示：

    SystemServer.main()      // Zygote会从Native层调用该方法，进入SystemServer的执行代码
    └── SystemServer.run()  // SystemServer一旦运行起来，就一直循环处理消息队列中的消息
        └── SystemServer.createSystemContext()  // 创建SystemContext

SystemContext到底是什么呢？说到底，它还是一个Context类型的对象，需要借助于ActivityThread才能获取到：

{% highlight java %}
// SystemServer.createSystemContext()
private void createSystemContext() {
    ActivityThread activityThread = ActivityThread.systemMain();
    mSystemContext = activityThread.getSystemContext();
    mSystemContext.setTheme(android.R.style.Theme_DeviceDefault_Light_DarkActionBar);
}
{% endhighlight %}

**ActivityThread.systemMain()**函数用于创建系统进程的主线程,方法主体很简单，创建了一个新的ActivityThread对象，并调用了**attach()**方法，输入参数是true，表示需要将其绑定到系统进程。

> 应用进程创建ActivityThread对象是通过**ActivityThread.main()**函数完成的。由于系统进程的特殊性，专辟了一个**systemMain()**函数给系统进程。

{% highlight java %}
public static ActivityThread systemMain() {
    ... // 省略硬件渲染相关配置的代码
    ActivityThread thread = new ActivityThread();
    thread.attach(true);
    return thread;
}
{% endhighlight %}

接下来，我们来着重分析一下**ActivityThread.attach()**函数：

{% highlight java %}
private void attach(boolean system) {
    sCurrentActivityThread = this;
    mSystemThread = system;
    if (!system) {
        ... // 绑定应用进程，本例仅讨论绑定系统进程，故省略之
    } else {
        // 设置进程名为system_process
        android.ddm.DdmHandleAppName.setAppName("system_process", UserHandle.myUserId());
        try {
            mInstrumentation = new Instrumentation();
            ContextImpl context = ContextImpl.createAppContext(
                this, getSystemContext().mPackageInfo);
            mInitialApplication = context.mPackageInfo.makeApplication(true, null);
            mInitialApplication.onCreate();
        } catch (Exception e) { ... // 省略抛出异常的代码 }
    }

    // 设置与输出日志相关的Dropbox
    DropBox.setReporter(new DropBoxReporter());
    ViewRootImpl.addConfigCallback( ... // );
}
{% endhighlight %}

在上面的函数实现中，会创建几个很重要的对象：

- **mInstrumentation**： 工具类，主要用于测试，与AndroidManifest.xml中&lt;instrumentation&gt;对应;

- **context**: Application的运行环境，创建它的目的是为了创建下面的Application对象。创建这个context需要传入一个LoadedApk类型的对象，通过**ActivityThread.getSystemContext()**函数便可获取：

{% highlight java %}
public ContextImpl getSystemContext() {
    synchronized (this) {
        if (mSystemContext == null) {
            mSystemContext = ContextImpl.createSystemContext(this);
        }
        return mSystemContext;
    }
}
{% endhighlight %}

这里是第一次调用**getSystemContext()**函数，所以**mSystemContext**为null，进而会通过**ContextImpl.createSystemContext()**函数创建一个新的对象：

{% highlight java %}
// ContextImpl.createSystemContext()
static ContextImpl createSystemContext(ActivityThread mainThread) {
    LoadedApk packageInfo = new LoadedApk(mainThread);
    ContextImpl context = new ContextImpl(null, mainThread,
            packageInfo, null, null, false, null, null, Display.INVALID_DISPLAY);
    context.mResources.updateConfiguration(context.mResourcesManager.getConfiguration(),
            context.mResourcesManager.getDisplayMetricsLocked());
    return context;
}
{% endhighlight %}

上述函数首先会创建一个LoadedApk的对象，LoadedApk表示一个装载到内存的Apk，对于SystemContext，这个Apk就是**framework-res.apk**;
然后，创建一个ContextImpl的对象，进一步初始化资源相关的配置; 最终，返回的context就是SystemContext。

- **mInitialApplication**: Application对象，由于是通过**framework-res.apk**这个APK的Context创建而来，所以这个Application对象就对应到了**framework-res.apk**，这是系统中第一个运行的APK，所以叫做InitialApplication，它是运行在系统进程中。

兜兜转转弄了一圈，终于把SystemContext给创建好了，系统进程好好运行就好了，为什么要大费周张的搞一个运行环境Context出来呢？
操作系统运行基本单位是进程，我们写的任何Android代码最终都要落到一个实际的进程中去执行。然而，Android有意弱化了进程的概念，我们在写Android应用程序的时候，基础的概念都是运行环境(Context)，而不是去考虑进程中有什么可以使用。
Android对待系统进程，也像对待普通的应用进程一样，都需要构建一个运行环境，就是Context。在构建AMS对象时，会将SystemContext传入，通过这个特殊的Context，AMS就能获取运行时所需要各种信息。

我们通过一张类图来总结一下，与系统进程运行环境初始化相关的各个类之间的关系：

<div align="center"><img src="/assets/images/systemservice/amslaunching/2-amslaunching-activitythread-classes-diagram.png" alt="Classes Diagram"/></div>

1. Android要为应用进程创造一个运行环境，同样也需要为系统进程创造一个运行环境，在系统进程启动伊始，这个运行环境就需要创建完毕;

2. SystemServer会创建一个ActivityThread对象，代表系统进程的主线程，在ActivityThread对象构建的过程中，又会创建Instrumentation对象和framework-res.apk的LoadedApk对象，再通过LoadedApk创建Application对象;

3. 在ActivityThread对象构建完毕后，SystemServer便可获取到系统进程的运行环境了，即SystemContext，这是ActivityThread通过ContextImpl创建而成的。

## 2.2 初始化ActivityManagerService

### 2.2.1 SystemService和SystemServiceManager

在Android起机的过程中，系统服务是相互影响的，所以有启动顺序的先后之分，譬如BatteryService，WindowManagerService就需要在ActivityManagerService创建之后才能创建。还有一些系统事件，譬如BOOT_COMPLETED广播，需要在系统完全启动之后才能发出。
Android为系统服务封装了SystemService类，设计了系统服务的生命周期：

{% highlight java %}
public abstract class SystemService {
    // 阶段 1： 等待显示设备准备完毕
    // 这个阶段，Installer, AMS, PowerManagerService, DisplayManagerService已经构建完毕
    public static final int PHASE_WAIT_FOR_DEFAULT_DISPLAY = 100;
    // 阶段 2： 锁屏服务已经准备完毕
    // 这个阶段，大部分系统服务已经构建完毕。其他服务可以获取锁屏相关的数据了，譬如锁屏密码等
    public static final int PHASE_LOCK_SETTINGS_READY = 480;
    // 阶段 3: 系统服务已经准备完毕
    // 这个阶段，大部分系统服务已经构建完毕，PackageManagerService，PowerManagerService已经能够提供服务
    public static final int PHASE_SYSTEM_SERVICES_READY = 500;
     // 阶段 4： ActivityManagerService已经能够提供服务了
     // 这个阶段，获取ContentProvider、发送广播等AMS相关的功能已经可以用了
    public static final int PHASE_ACTIVITY_MANAGER_READY = 550;
     // 阶段 5： 已经可以启动应用程序了
     // 这个阶段，用户界面已经启动，数据连接、音频等服务都已可用
    public static final int PHASE_THIRD_PARTY_APPS_CAN_START = 600;
    // 阶段 6： 系统起机完成
    public static final int PHASE_BOOT_COMPLETED = 1000;

    public abstract void onStart();
    public void onBootPhase(int phase) {}

    // ... 省略其他函数
}
{% endhighlight %}

部分系统服务的初始化依赖于当前系统已经起机到什么阶段，当系统服务启动时，onStart()函数会被调用; 系统启动到一定的阶段，onBootPhase()函数会被调用。所有系统服务的创建和生命周期的管理都是由**SystemServiceManager**这个类完成的，笔者着重分析该类的两个函数：

- **startService()**: 启动系统服务

{% highlight java %}
// 这是一个范型方法，SystemService的子类都是通过这种方式启动的。
public <T extends SystemService> T startService(Class<T> serviceClass) {
    final String name = serviceClass.getName();
    Slog.i(TAG, "Starting " + name);

    // 判断是否为SystemService的子类
    if (!SystemService.class.isAssignableFrom(serviceClass)) {
        throw new RuntimeException("Failed to create " + name
                + ": service must extend " + SystemService.class.getName());
    }

    // 通过反射构建一个新的SystemService对象
    final T service;
    try {
        Constructor<T> constructor = serviceClass.getConstructor(Context.class);
        service = constructor.newInstance(mContext);
    } catch (InstantiationException ex) { ... // 省略catch其他异常 }

    // 将新创建的服务添加到全局列表
    mServices.add(service);

    try {
        // 调用SystemService.onStart()函数
        service.onStart();
    } catch (RuntimeException ex) { ... }

    return service;
}
{% endhighlight %}

- **startBootPhase()**: 进入当前所在的起动阶段，即上文SystemService中定义的6个阶段之一

{% highlight java %}
public void startBootPhase(final int phase) {
    // SystemServiceManager中通过mCurrentPhase属性表示当前所在的阶段
    if (phase <= mCurrentPhase) {
        throw new IllegalArgumentException("Next phase must be larger than previous");
    }
    mCurrentPhase = phase;

    // 通知所有的SystemService当前所处的启动阶段，通过调用SystemService.onBootPhase()函数实现
    final int serviceLen = mServices.size();
    for (int i = 0; i < serviceLen; i++) {
        final SystemService service = mServices.get(i);
        try {
            service.onBootPhase(mCurrentPhase);
        } catch (Exception ex) {
            ...
        }
    }
}
{% endhighlight %}


具体到本文中要分析的AMS，它并没有直接继承SystemService，而是通过内部类Lifecycle来继承实现的，
AMS.Lifecycle非常简单，就是调用了AMS的构造函数和start()函数，是一个间接初始化AMS的过程。

{% highlight java %}
public static final class Lifecycle extends SystemService {
    private final ActivityManagerService mService;

    // 构造函数会被SystemServiceManager反射调用
    public Lifecycle(Context context) {
        super(context);
        mService = new ActivityManagerService(context);
    }

    // 在Lifecycle对象构造完成后，这个函数会被回调
    @Override
    public void onStart() {
        mService.start();
    }

    public ActivityManagerService getService() {
        return mService;
    }
}
{% endhighlight %}

我们通过类图来总结一下SystemServiceManager, SystemService以及AMS三者之间的关系：

<div align="center"><img src="/assets/images/systemservice/amslaunching/3-amslaunching-systemservice-classes-diagram.png" alt="System Service  Classes Diagram"/></div>

1. SystemService是系统服务的抽象类，封装了onStart()和onBootPhase()等生命周期函数供SystemServiceManager回掉;

2. AMS并不是直接继承SystemService，而是通过内部类Lifecycle间接完成了系统服务启动的生命周期;

2. SystemServiceManager管理了多个SystemService。

### 2.2.2 SystemServer和ActivityManagerService

SystemServer在完成一些简单的初始化后，就需要启动系统服务了，最重要的一系列服务是在**SystemServer.startBootstrapServices()**
这个函数中启动的，BootstrapServices的命名也很贴切，表示要启动一些"引导服务"，这些服务直接影响到其他服务的启动。

{% highlight java %}
private void startBootstrapServices() {
    // 1. 启动Installer系统服务
    Installer installer = mSystemServiceManager.startService(Installer.class);

    // 2. 启动AMS
    mActivityManagerService = mSystemServiceManager.startService(
        ActivityManagerService.Lifecycle.class).getService();
    mActivityManagerService.setSystemServiceManager(mSystemServiceManager);
    mActivityManagerService.setInstaller(installer);

    // 3. 启动PowerManagerService
    mPowerManagerService = mSystemServiceManager.startService(PowerManagerService.class);
    mActivityManagerService.initPowerManagement();

    // 4. 启动LED和背光灯、显示、包管理这些重要的系统服务
    mSystemServiceManager.startService(LightsService.class);
    mDisplayManagerService = mSystemServiceManager.startService(DisplayManagerService.class);
    ...
    mPackageManagerService = PackageManagerService.main(mSystemContext, installer,
                mFactoryTestMode != FactoryTest.FACTORY_TEST_OFF, mOnlyCore);
    mFirstBoot = mPackageManagerService.isFirstBoot();
    mPackageManager = mSystemContext.getPackageManager();

    // 5. 设置当前进程为系统进程
    mActivityManagerService.setSystemProcess();

    // 6. 启动Sensor相关的服务。这是一个Native方法，与硬件相关度较大。
    startSensorService();
}
{% endhighlight %}

1. 启动AMS之前，需要先连接installd进程。在系统进程(system_process)中，对应的服务就Installer，
   通过Installer这个服务，就能完成一些重要目录的创建，譬如/data/user。

2. 启动AMS。由此可见AMS的重要性，Android第二个启动的系统服务就是AMS。
   实际上，这里通过SystemServcieManager来启动的是AMS.Lifecycle，AMS的真正初始化工作是由AMS.Lifecyle间接完成的。

3. 启动PowerManagerService，这也是非常重要的一个系统服务。AMS也需要使用PowerManagerService的服务，
   譬如，在启动Activity时，要避免系统进入休眠状态，就需要获取WakeLock。

4. 这一步启动Lights、 DisplayManager、 PackageManager这些系统服务。

5. 调用**AMS.setSystemProcess()**将当前进程设置为系统进程。为什么在SystemServer中需要调用AMS的方法来设置当前进程的信息呢？
   因为AMS的职责之一就是维护所有进程的状态，不管是应用进程还是系统进程，都是AMS的管辖范围。

上述步骤中，与AMS直接相关的是**第2步**和**第5步**，我们再深入展开分析这两个步骤：

**在第2步中**，AMS.Lifecycle最终还是会调用AMS的构造器来实例化一个AMS对象：

{% highlight java %}
public ActivityManagerService(Context systemContext) {
    mContext = systemContext;
    // 是否为测试模式，0表示关闭
    mFactoryTest = FactoryTest.getMode();
    // 表示主线程的变量。在AMS对象构建之前，系统进程的主线程已经构建好了。
    mSystemThread = ActivityThread.currentActivityThread();
    // 创建了绑定了消息队列的线程并运行，这个线程就是AMS线程，要处理大量的消息
    mHandlerThread = new ServiceThread(TAG,
            android.os.Process.THREAD_PRIORITY_FOREGROUND, false /*allowIo*/);
    mHandlerThread.start();
    mHandler = new MainHandler(mHandlerThread.getLooper());
    // 创建UI绑定到全局UI线程的Handler，ANR的对话框显示的消息就会抛到全局UI线程上面
    mUiHandler = new UiHandler();

    // 创建广播消息队列。有前/后台之分，为了区分不同的广播消息超时时间。
    mFgBroadcastQueue = new BroadcastQueue(this, mHandler,
            "foreground", BROADCAST_FG_TIMEOUT, false);
    mBgBroadcastQueue = new BroadcastQueue(this, mHandler,
            "background", BROADCAST_BG_TIMEOUT, true);
    mBroadcastQueues[0] = mFgBroadcastQueue;
    mBroadcastQueues[1] = mBgBroadcastQueue;

    // AMS所管理的Service和Provider
    mServices = new ActiveServices(this);
    mProviderMap = new ProviderMap(this);

    // 创建 /data/system 目录，诸如包管理packages.xml, packages.list等文件都存放于此目录
    File dataDir = Environment.getDataDirectory();
    File systemDir = new File(dataDir, "system");
    systemDir.mkdirs();

    // 创建电量统计服务
    mBatteryStatsService = new BatteryStatsService(systemDir, mHandler);
    ... // 省略部分电量统计服务的初始化代码

    // 创建CPU/内存等信息统计服务，内部实现就是读取 /proc/stat
    mProcessStats = new ProcessStatsService(this, new File(systemDir, "procstats"));
    mAppOpsService = new AppOpsService(new File(systemDir, "appops.xml"), mHandler);
    mGrantFile = new AtomicFile(new File(systemDir, "urigrants.xml"));

    // 在多用户场景下。USER_OWNER(0)是启动时唯一的用户
    mStartedUsers.put(UserHandle.USER_OWNER, new UserState(UserHandle.OWNER, true));
    mUserLru.add(UserHandle.USER_OWNER);
    updateStartedUserArrayLocked();

    // 获取OpenGL版本号
    GL_ES_VERSION = SystemProperties.getInt("ro.opengles.version",
        ConfigurationInfo.GL_ES_VERSION_UNDEFINED);

    // 配置区域、语言、字体、屏幕方向等，启动Activity时，需要用到这个配置
    mConfiguration.setToDefaults();
    ... // 省略部分Configuration的初始化
    mProcessCpuTracker.init();
    // AndroidManifest.xml中compatible-screens相关的解析工具
    mCompatModePackages = new CompatModePackages(this, systemDir, mHandler);
    // Intent防火墙
    mIntentFirewall = new IntentFirewall(new IntentFirewallInterface(), mHandler);
    // 多任务列表。Task就是任务栈，最近使用的任务都会出现在列表中
    mRecentTasks = new RecentTasks(this);
    // 多个ActivityStack的管理者
    mStackSupervisor = new ActivityStackSupervisor(this, mRecentTasks);
    // 将任务写入文件的工具类
    mTaskPersister = new TaskPersister(systemDir, mStackSupervisor, mRecentTasks);

    // 创建定期更新CPU统计信息的线程
    mProcessCpuThread = new Thread("CpuTracker") {...//省略具体实现}

    // 将自身添加到WatchDog中，以便监测Service的运行状态，譬如是否发生死锁、消息队列是否阻塞
    Watchdog.getInstance().addMonitor(this);
    Watchdog.getInstance().addThread(mHandler);
}
{% endhighlight %}

再来看一下AMS对象初始化后，紧接着调用的**AMS.start()**函数：

{% highlight java %}
private void start() {
    Process.removeAllProcessGroups();
    // 启动CPU使用统计线程
    mProcessCpuThread.start();

    // 设置电量使用统计服务和权限管理服务的一些参数，并将其添加到ServiceManager
    mBatteryStatsService.publish(mContext);
    mAppOpsService.publish(mContext);

    // LocalServices类似于ServiceManager的功能，主要用于系统进程内部访问的一些服务
    LocalServices.addService(ActivityManagerInternal.class, new LocalService());
}
{% endhighlight %}

经过第2步，AMS对象就已经构建完毕。构建时，要初始化的内容非常多，大致可以分成两类：

  - **监测统计**: Watchdog，CPU、内存、电量的使用统计
  - **组件管理**: broadcastQueues, services, providers, statckSupervisor，recentTasks, Android四大组件的相关信息都由AMS统一维护

**在第5步中**, 通过AMS对象调用了**setSystemProcess()**函数，目的是为了将当前进程(system_process)设置为系统进程：

{% highlight java %}
public void setSystemProcess() {
    try {
        // 1. 注册系统服务
        ServiceManager.addService(Context.ACTIVITY_SERVICE, this, true);
        ServiceManager.addService(ProcessStats.SERVICE_NAME, mProcessStats);
        ServiceManager.addService("meminfo", new MemBinder(this));
        ServiceManager.addService("gfxinfo", new GraphicsBinder(this));
        ServiceManager.addService("dbinfo", new DbBinder(this));
        if (MONITOR_CPU_USAGE) {
            ServiceManager.addService("cpuinfo", new CpuBinder(this));
        }
        ServiceManager.addService("permission", new PermissionController(this));
        ServiceManager.addService("processinfo", new ProcessInfoService(this));

        // 2. 装载应用信息，将ApplicationInfo和ClassLoader设置到LoadedApk中
        ApplicationInfo info = mContext.getPackageManager().getApplicationInfo(
                "android", STOCK_PM_FLAGS);
        mSystemThread.installSystemApplicationInfo(info, getClass().getClassLoader());

        // 3. 初始化进程的ProcessRecord
        synchronized (this) {
            ProcessRecord app = newProcessRecordLocked(info, info.processName, false, 0);
            app.persistent = true; // 常驻内存
            app.pid = MY_PID;      // 当前的PID
            app.maxAdj = ProcessList.SYSTEM_ADJ;  // 在内存不足时，会根据oom_adj值来杀进程
            app.makeActive(mSystemThread.getApplicationThread(), mProcessStats);
            synchronized (mPidsSelfLocked) {
                mPidsSelfLocked.put(app.pid, app);
            }
            updateLruProcessLocked(app, false, null);  // 更新最近使用进程列表
            updateOomAdjLocked();   // 更新OOM ADJ
        }
    } catch (PackageManager.NameNotFoundException e) {
        throw new RuntimeException(
                "Unable to find android system package", e);
    }
}
{% endhighlight %}

1. 通过ServiceManager向系统注册一些重要的服务。诸如meminfo、gfxinfo、dbinfo等信息都是由系统进程维护的，
   可以通过`adb shell dumpsys`命令输出。

2. ApplicationInfo包含了一个应用程序的信息，这些信息从AndroidManifest.xml的&lt;application&gt;标签中解析出来，譬如进程名、版本号、使用的主题等，那么，通过**android**这个包名，获取的ApplicationInfo自然就是Android系统这个应用程序的信息。

    > 每一个普通的应用程序都会有一个AndroidManifest.xml文件，这个应用程序运行的环境，就是我们所说的"应用进程";
    > 有一个特殊的应用程序，具备更多的特权，这个应用程序的运行环境就是"系统进程"。
    > **android**就是这个特殊应用程序的包名，其所对应的&lt;application&gt;标签定义在[frameworks/base/core/res/AndroidManifest.xml]({{ site.android_source }}/platform/frameworks/base/+/master/core/res/AndroidManifest.xml)中，最终会编译在**framework-res.apk**中。

    不论是应用进程还是系统进程，都有主线程，ActivityThread就是Android定义的主线程类。
    AMS中的**mSystemThread**对象就是ActivityThread的实例，表示这是系统进程的主线程。
    通过**mSystemThread.installSystemApplicationInfo()**这个函数调用，ApplicationInfo和ClassLoader就被设置到了
    LoadedApk中，ApplicationInfo与LoadedApk的关系我们后文再描述。

3. ProcessRecord这个类用于描述一个运行的进程，AMS管理着所有ProcessRecord的状态，包括系统进程的ProcessRecord。
   系统进程的ProcessRecord几个重要的属性值：

   - **persistent=true**： 系统进程的ProcessRecord是常驻内存的
   - **maxAdj=SYSTEM_ADJ(-16)**： 在内存不足时，这个值越小，存活的几率就越大。SYSTEM_ADJ已经是倒数第二小了，可见系统进程在内存不足时被杀的可能性极小。
   - **active**: 在上文中，我们介绍过ProcessRecord有Active和InActive两种状态，所谓"激活"，就是将应用程序的信息(IApplicationThread)绑定到进程，这样就能够通过ProcessRecord**间接**完成对进程的调度。

   AMS通过**mPidSelfLocked**这个映射表来记录所有的ProcessRecord，(键 => 值)关系是(PID => ProcessRecord)。
   在创建一个ProcessRecord之后，就需要集中对进程的信息进行调整了，AMS中管理进程的函数就两类：**updateLruProcessLocked()**用于更新最近使用进程列表，**updateOomAdjLocked()**用户更新进程的OOM ADJ。具体的调用场景和实现，留到后文分析。

## 2.3 AMS启动的配套工作

在引导服务(BootstrapServices)启动完毕后，SystemServer就开始启动核心服务(CoreServices)，包括电池服务(BatteryService)，用户行为统计服务(UsageStatsService)等; 最后，就是启动其他服务了，非常之多，不再此列举。部分服务在启动时，仍需要与AMS关联，譬如: AMS需要与WindowManagerService关联。AMS在这个过程之中有两个关键的步骤:

1. **AMS.installSystemProviders()**: 表示要装载SettingsProvider, 很多系统服务都需要从这个数据库中读取配置信息;
2. **AMS.systemReady()**: 表示当前SystemServer已经启动完毕, AMS仍需要做一些准备就绪工作。

这两个步骤牵扯到的逻辑非常之庞大,我们现在深入分析之。

### 2.3.1 installSystemProviders

{% highlight java %}
public final void installSystemProviders() {
    List<ProviderInfo> providers;
    synchronized (this) {
        // 获取系统进程的ProcessRecord, 之前setSystemProcess()时,
        // 会基于framework-res.apk的AndroidManifest.xml新建一个ProcessRecord,
        // 此处,获取的ProcessRecord就是它
        ProcessRecord app = mProcessNames.get("system", Process.SYSTEM_UID);
        // 生成ProviderInfo的列表
        providers = generateApplicationProvidersLocked(app);
        // 剔除一些非系统程序的Provider
        if (providers != null) {
            for (int i=providers.size()-1; i>=0; i--) {
                ProviderInfo pi = (ProviderInfo)providers.get(i);
                if ((pi.applicationInfo.flags&ApplicationInfo.FLAG_SYSTEM) == 0) {
                    providers.remove(i);
                }
            }
        }
    }
    // 将Provider安装到系统进程中
    if (providers != null) {
        mSystemThread.installSystemProviders(providers);
    }

    mCoreSettingsObserver = new CoreSettingsObserver(this);
}
{% endhighlight %}

以上有两个关键的函数,我们再进一步展开分析:

<font size="3"><b>关键函数: generateApplicationProvidersLocked()</b></font>

该函数基于AndroidManifest.xml文件的定义, 生成一个应用程序的Provider信息, 以方便AMS对Provider进行管理, 函数的逻辑如下所示:

{% highlight java %}
private final List<ProviderInfo> generateApplicationProvidersLocked(ProcessRecord app) {
    // 1. 获取指定processName和uid中的Provider信息
    List<ProviderInfo> providers = null;
    try {
        ParceledListSlice<ProviderInfo> slice = AppGlobals.getPackageManager().
            queryContentProviders(app.processName, app.uid,
                    STOCK_PM_FLAGS | PackageManager.GET_URI_PERMISSION_PATTERNS);
        providers = slice != null ? slice.getList() : null;
    } catch (RemoteException ex) { }

    // 2. 将Provider和ProcessRecord绑定
    int userId = app.userId;
    if (providers != null) {
        // 确保ProcessRecord中的Provider映射表的容量
        int N = providers.size();
        app.pubProviders.ensureCapacity(N + app.pubProviders.size());

        // 遍历ProviderInfo列表
        for (int i=0; i<N; i++) {
            ProviderInfo cpi = (ProviderInfo)providers.get(i);
            boolean singleton = isSingleton(cpi.processName, cpi.applicationInfo,
                cpi.name, cpi.flags);
            if (singleton && UserHandle.getUserId(app.uid) != UserHandle.USER_OWNER) {
                providers.remove(i);
                N--;
                i--;
                continue;
            }

            // 如果mProviderMap中不存在ContentProviderRecord对象,则新建一个
            ComponentName comp = new ComponentName(cpi.packageName, cpi.name);
            ContentProviderRecord cpr = mProviderMap.getProviderByClass(comp, userId);
            if (cpr == null) {
                cpr = new ContentProviderRecord(this, cpi, app.info, comp, singleton);
                mProviderMap.putProviderByClass(comp, cpr);
            }
            app.pubProviders.put(cpi.name, cpr);

            if (!cpi.multiprocess || !"android".equals(cpi.packageName)) {
                app.addPackage(cpi.applicationInfo.packageName,
                    cpi.applicationInfo.versionCode, mProcessStats);
            }
            // 对APK进行dex优化
            ensurePackageDexOpt(cpi.applicationInfo.packageName);
        }
    }
    return providers;
}
{% endhighlight %}

- **第1步**, 指定processName为"system", uid为"Process.SYSTEM_UID(1000)", 通过PackageManager,可以获取到运行在系统进程中的所有Provider的信息。这里获取的结果是一个元素为ProviderInfo类型的列表。一般而言，以下Provider会出现在返回结果中:

    - framework-res.apk中的Provider, 定义在frameworks/base/core/res/AndroidManifest.xml
    - SettingsProvider.apk中的Provider, 定义在frameworks/base/packages/SettingsProvider/AndroidManifest.xml

{% highlight xml %}
<!-- frameworks/base/core/res/AndroidManifest.xml片段 -->
    <provider android:name="com.android.server.am.DumpHeapProvider"
              android:authorities="com.android.server.heapdump"
              android:grantUriPermissions="true"
              android:multiprocess="false"
              android:singleUser="true" />
{% endhighlight %}

{% highlight xml %}
<!-- frameworks/base/packages/SettingsProvider/AndroidManifest.xml -->
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
        package="com.android.providers.settings"
        coreApp="true"
        android:sharedUserId="android.uid.system">  表示UID为SYSTEM_UID
    <application android:allowClearUserData="false"
             android:label="@string/app_label"
             android:process="system"  表示运行在系统进程之中
             android:backupAgent="SettingsBackupAgent"
             android:killAfterRestore="false"
             android:icon="@mipmap/ic_launcher_settings">
        <provider android:name="SettingsProvider" android:authorities="settings"
              android:multiprocess="false"
              android:exported="true"
              android:singleUser="true"
              android:initOrder="100" />
    </application>
</manifest>
{% endhighlight %}

- **第2步**,  通过PackageManager获取到的ProviderInfo只是一个静态的信息, 还需要绑定到具体的ProcessRecord。
   要理解这个绑定关系,需要先了解AMS对Provider的管理方式:

<div align="center"><img src="/assets/images/systemservice/amslaunching/4-amslaunching-provider-classes-diagram.png" alt="Provider Classes Diagram"/></div>

   - AMS中使用ContentProviderRecord来管理一个ContentProvider。ProviderInfo, ApplicationInfo, 运行ContentProvider的ProcessRecord等信息都保存在ContentProviderRecord中。

   - AMS维护了一个ProviderMap, 支持从Authority或CompnentName到ContentProviderRecord的映射; AMS也维护了各种各样的ProcessRecord, 譬如: 前台进程, 内存常驻进程, 最近使用的进程等。 当一个ContentProvider绑定到具体的进程时, 就会添加到ProcessRecord中维护的mPubProviders的映射表中。所以, ProcessRecord.mPubProviders就表示进程所拥有的ContentProvider。

  现在,我们再来看这块函数的逻辑:

   - 首先, 需要确保ProcessRecord能够容纳一定数量的Provider, 前面通过PackageManager找到的ProviderInfo可能会关联到ProcessRecord中,所以, 在mPubProvider上已有容量的基础上, 再扩容的大小为找到的ProviderInfo的数量。

   - 然后, 对找到的ProviderInfo列表进行遍历, 如有需要, 则新建一个ContentProviderRecord对象, 将其添加到mProviderMap中以方便AMS管理；同时, 也需要将其添加到PrcoessRecord.mPubProviders中。

   - 最后, 由于可能新增其他APK中的ProviderInfo, 所以需要确保对APK进行dex优化。

<font size="3"><b>关键函数: ActivityThread.installSystemProviders()</b></font>

将一个ProviderInfo绑定到ProcessRecord后, AMS中就有了Provider的信息了, 但这时Provider还不能工作, 因为真正的ContentProvider还未创建, 该函数的就是将上面找到的ProviderInfo装载到系统进程之中, 函数的逻辑如下:

{% highlight java %}
public final void installSystemProviders(List<ProviderInfo> providers) {
    if (providers != null) {
        // 在前文创建ActivityThread并attch的时候,就见过mInitialApplication
        // 它是什么呢? 请读者自行回顾前文。
        installContentProviders(mInitialApplication, providers);
    }
}

private void installContentProviders(Context context, List<ProviderInfo> providers) {
    // 待填充的ContentProviderHolder列表
    final ArrayList<IActivityManager.ContentProviderHolder> results =
        new ArrayList<IActivityManager.ContentProviderHolder>();
    // 对ProviderInfo列表进行遍历, 调用的installProvider()函数逻辑下文展开分析
    for (ProviderInfo cpi : providers) {
        IActivityManager.ContentProviderHolder cph = installProvider(context, null, cpi,
            false /*noisy*/, true /*noReleaseNeeded*/, true /*stable*/);
        if (cph != null) {
            cph.noReleaseNeeded = true;
            results.add(cph);
        }

        try {
            // 向AMS注册ContentProvider
            ActivityManagerNative.getDefault().publishContentProviders(
                getApplicationThread(), results);
        } catch (RemoteException ex) { }
    }
}
{% endhighlight %}

所有ContentProvider的创建都需要经过**installContentProvider()**函数, 它接收两个参数, 一个是进程的运行环境Context, 一个是
ProviderInfo列表； 对系统进程而言, 运行环境就是mInitialApplication。该函数中使用了ContentProviderHodler这个类,它实现了Parcelable接口, 通常表示这类数据结构需要跨进程传递, 应用进程中生成的ContentProvider需要向系统进程注册后才能使用, 所以, 需要将ContentProvider的信息从应用进程传递到系统进程, 这就用到了ContentProviderHolder进行数据封装。

基于ProviderInfo生成的ContentProviderHolder的函数实现是**installProvider()**:

{% highlight java %}
private IActivityManager.ContentProviderHolder installProvider(Context context,
        IActivityManager.ContentProviderHolder holder, ProviderInfo info,
        boolean noisy, boolean noReleaseNeeded, boolean stable) {
    // 本例中传入的context为mInitialApplication, 表示系统进程的运行环境;
    // holder为null, 表示需要创建新的Hodler； info为系统进程中的ProviderInfo
    // noReleaseNeeded表示

    ContentProvider localProvider = null;
    IContentProvider provider;
    if (holder == null || holder.provider == null) {
        Context c = null;
        ApplicationInfo ai = info.applicationInfo;
        // 1. 找到ProviderInfo对应的Context
        if (context.getPackageName().equals(ai.packageName)) {
            c = context;
        } else if (mInitialApplication != null &&
                mInitialApplication.getPackageName().equals(ai.packageName)) {
            c = mInitialApplication;
        } else {
            try {
                c = context.createPackageContext(ai.packageName, Context.CONTEXT_INCLUDE_CODE);
            } catch (PackageManager.NameNotFoundException e) { }
        }

        if (c == null) {
            // ... 省略日志输出
            return null;
        }

        // 2. 根据包名,反射创建新的ContentProvider对象
        try {
            final java.lang.ClassLoader cl = c.getClassLoader();
            localProvider = (ContentProvider)cl.loadClass(info.name).newInstance();
            provider = localProvider.getIContentProvider();
            if (provider == null) {
                return null;
            }
            localProvider.attachInfo(c, info);
        } catch (java.lang.Exception e) {
            return null;
        }
    } else {
        provider = holder.provider;
    }

    // 3. 设置ConentProviderHolder
    IActivityManager.ContentProviderHolder retHolder;
    synchronized (mProviderMap) {
        IBinder jBinder = provider.asBinder();
        if (localProvider != null) {
            ComponentName cname = new ComponentName(info.packageName, info.name);
            ProviderClientRecord pr = mLocalProvidersByName.get(cname);
            if (pr != null) {
                provider = pr.mProvider;
            } else {
                // 创建一个新的ContentClientProvider
                holder = new IActivityManager.ContentProviderHolder(info);
                holder.provider = provider;
                holder.noReleaseNeeded = true;
                pr = installProviderAuthoritiesLocked(provider, localProvider, holder);
                mLocalProviders.put(jBinder, pr);
                mLocalProvidersByName.put(cname, pr);
            }
            retHolder = pr.mHolder;
        } else {
            ProviderRefCount prc = mProviderRefCountMap.get(jBinder);
            if (prc != null) {
                if (!noReleaseNeeded) {
                }
            } else {
                ProviderClientRecord client = installProviderAuthoritiesLocked(
                        provider, localProvider, holder);
                if (noReleaseNeeded) {
                    prc = new ProviderRefCount(holder, client, 1000, 1000);
                } else {
                    prc = stable
                              ? new ProviderRefCount(holder, client, 1, 0)
                              : new ProviderRefCount(holder, client, 0, 1);
                }
                mProviderRefCountMap.put(jBinder, prc);
            }
            retHolder = prc.holder;
        }
    }
    return retHolder;
}
{% endhighlight %}

1. 找到ProviderInfo对应的Context：

   - 对于framework-res.apk中定义的com.android.server.am.DumpHeapProvider而言, 重新设置的Context就是mInitialApplication
   - 对于SettingProvider.apk中定义的SettingsProvider而言, 它的包名为com.android.providers.settings, 不等于mInitialApplication的包名android, 所以, 会通过Context.createPackageContext()函数创建一个新的Context

2. 反射创建ContentProvider对象, 之所以前面要找到ProviderInfo的Context, 就是因为只有与ContentProvider对应的Context才能从APK中加载Java字节码进行反射。在ContentProvider创建好后, 会调用ContentProvider.attach()函数, 其内部进行一些初始化操作后, 会调用ContentProvider.onCreate()函数, 这样以来, ContentProvider就进入其生命周期了。

3. 设置CotentProviderHolder。要理解这一段逻辑, 需要先理解ContentProvider的管理机制. 在[Android四大组件之ContentProvider]()一文中有详细的介绍, 在此, 我们只需要了解这里会找到ContentProviderHolder， 拿到这个数据结构后， 就能向AMS申报Provider可以使用了。

**至此， installSystemProviders()函数的逻辑已经分析完毕，该函数的功能就是装载运行在系统进程中的Provider，诸如SettingsProvider这一类需要被很多其他系统服务用到的Provider，都将在这一步被装载。**

### 2.3.2 systemReady

该函数的逻辑比较庞大，我们按序分成几个片段分析。

{% highlight java %}
// 片段1： 主要处理PRE_BOOT_COMPLETED广播
public void systemReady(final Runnable goingCallback) {
    synchronized(this) {
        // 1. 判断系统进程是否已经准备完毕，如果已经准备完毕，则调用goingCallback后返回
        if (mSystemReady) {
            if (goingCallback != null) {
                goingCallback.run();
             }
             return;
        }
        mLocalDeviceIdleController
                = LocalServices.getService(DeviceIdleController.LocalService.class);

        // Make sure we have the current profile info, since it is needed for
        // security checks.
        updateCurrentProfileIdsLocked();

        // 2. 恢复最近任务列表
        mRecentTasks.clear();
        mRecentTasks.addAll(mTaskPersister.restoreTasksLocked());
        mRecentTasks.cleanupLocked(UserHandle.USER_ALL);
        mTaskPersister.startPersisting();

        // 3. 处理PRE_BOOT_COMPLETED广播
        if (!mDidUpdate) {
            if (mWaitingUpdate) {
                return;
            }
            final ArrayList<ComponentName> doneReceivers = new ArrayList<ComponentName>();
            // 派发PRE_BOOT_COMPLETED广播， 函数参数Runnable是一个回调，当最后一个广播接收者处理完该广播后，
            // 则进入Runnable执行。
            mWaitingUpdate = deliverPreBootCompleted(new Runnable() {
                    public void run() {
                        synchronized (ActivityManagerService.this) {
                            mDidUpdate = true;
                        }
                        showBootMessage(mContext.getText(
                                R.string.android_upgrading_complete),
                                false);
                        writeLastDonePreBootReceivers(doneReceivers);
                        systemReady(goingCallback);
                    }
                }, doneReceivers, UserHandle.USER_OWNER);

                if (mWaitingUpdate) {
                    return;
                }
                mDidUpdate = true;
            }

            mAppOpsService.systemReady();
            mSystemReady = true;
        }
    } // END of synchronized
// 未完接片段2
{% endhighlight %}

1. mSystemReady表示系统进程是否准备完毕， 由于systemReady()函数会被多次调用到，而且多线程并行，所以一旦mSystemReady为true，表示不再需要执行下面的逻辑了，直接回调函数入参goingCallback，这个回调函数我们放到后面分析;

2. 进入这一步，表示mSystemReady为false，第一次进入systemReady()函数时，就是这种场景。这里会恢复最近任务列表;

3. 涉及到PRE_BOOT_COMPLETED广播的处理。这个广播在BOOT_COMPLETED广播之前发送，而且只发给系统应用。系统应用收到该广播后，也应该标注已经处理过该广播，下次不用再派发过来。设计PRE_BOOT_COMPLETED广播的目的，是为了应对系统升级的场景：当从旧的版本升级时，系统应用可能有一些清除数据的需要，系统升级后的第一次起机时，就会向接收者派发这个广播。

  PRE_BOOT_COMPLETED的派发实现在deliverPreBootCompleted()函数中，本文不展开分析。需要知道这里有两个控制变量：

  - mDidUpdate: 默认为false; 如果为true，表示已PRE_BOOT_COMPLETED已经处理完毕，确切的说是已经检查完毕，因为在派发该广播之前，要检查是否已经向接收者派发过一次该广播了; 之所以该变量取名为update，是因为该广播的设计与系统升级后的操作有关;
  - mWaitingUpdate: 默认为false; 如果有PRE_BOOT_COMPLETED的接收者，而且之前没有处理过该广播，则这个变量会被true，直到广播处理完成后才被重新置成false。

  经过这3步mSystemReady就被设置为true了，再次调用该systemReady()函数，就会进入第1步的逻辑。

{% highlight java %}
// 片段2： 杀掉在AMS准备就绪之前就已经启动的进程
    ArrayList<ProcessRecord> procsToKill = null;
    synchronized(mPidsSelfLocked) {
        for (int i=mPidsSelfLocked.size()-1; i>=0; i--) {
            ProcessRecord proc = mPidsSelfLocked.valueAt(i);
            if (!isAllowedWhileBooting(proc.info)){
                if (procsToKill == null) {
                    procsToKill = new ArrayList<ProcessRecord>();
                }
                procsToKill.add(proc);
            }
        }
    }

    synchronized(this) {
        if (procsToKill != null) {
            for (int i=procsToKill.size()-1; i>=0; i--) {
                ProcessRecord proc = procsToKill.get(i);
                removeProcessLocked(proc, true, false, "system update done");
            }
        }
    }
    // 表示AMS已经准备完毕，可以启动其他进程了
    mProcessesReady = true;

    EventLog.writeEvent(EventLogTags.BOOT_PROGRESS_AMS_READY,
                SystemClock.uptimeMillis());
// 未完接片段3
{% endhighlight %}

在AMS完全准备就绪之前，就可能有一些进程已经启动，在这里需要进行一个检查，如果非peristent的进程先于AMS启动，那么就需要杀掉这些进程。
注意，这里所指的进程是AMS管理的进程(系统进程和应用进程)，Native进程并不在AMS的管辖范围。

在该代码片段的最后，输出了一行Event Log：

	boot_process_ams_ready: xxx

进行日志分析时，可以根据这行日志信息判定AMS已经准备就绪，其他应用进程可以启动了。因为只有当AMS就绪后，才能开始管理应用进程。

{% highlight java %}
// 片段3： 读取SettingProvider、urigrants.xml等配置信息
    synchronized(this) {
        if (mFactoryTest == FactoryTest.FACTORY_TEST_LOW_LEVEL) {
            ... // 省略测试相关的代码
        }
    }

    // 从SettingsProvider中读取一些设置项
    retrieveSettings();
    // 加载与多任务显示相关的资源
    loadResourcesOnSystemReady();

    // 从/data/system/urigrants.xml文件中读取URI相关的权限信息
    synchronized (this) {
        readGrantedUriPermissionsLocked();
    }

    // 关键调用
    if (goingCallback != null) goingCallback.run();
// 未完接片段4
{% endhighlight %}

在AMS完全准备完毕后，就可以从SettingsProvider中读取一些配置信息了，以上代码片段中，最重要的就是调用传入的goingCallback.run()函数：

{% highlight java %}
public void run() {
    Slog.i(TAG, "Making services ready");
    // 通知所有的系统服务进入PHASE_ACTIVITY_MANAGER_READY阶段
    mSystemServiceManager.startBootPhase(
        SystemService.PHASE_ACTIVITY_MANAGER_READY);

    // 设置NativeCrash的监听器
    try {
        mActivityManagerService.startObservingNativeCrashes();
    } catch (Throwable e) {...}

    // 启动SystemUi
    try {
        startSystemUi(context);
    } catch (Throwable e) {...}

    // NetScorce系统服务进入systemReady状态
    try {
        if (networkScoreF != null) networkScoreF.systemReady();
    } catch (Throwable e) {...}

    ... // 省略其他系统服务进入systemReady状态
}
{% endhighlight %}

这个函数以回调的形式，在AMS准备就绪后被调用。AMS准备就绪是个关键节点，在此之后，很多其他服务就可以开始进入准备就绪的状态了，其实就是调用这些系统服务的systemReady()函数。

以上代码片段，还有一个关键事件就是启动SystemUi，其实就是启动com.androi.systemui这个包(对应的APK是SystemUI.apk)中的一个服务。

{% highlight java %}
static final void startSystemUi(Context context) {
    Intent intent = new Intent();
    intent.setComponent(new ComponentName("com.android.systemui",
                "com.android.systemui.SystemUIService"));
    context.startServiceAsUser(intent, UserHandle.OWNER);
}
{% endhighlight %}

回调完goingCallback.run()函数，AMS.systemReady()并没有就此结束，它还没有完成自己的使命。

{% highlight java %}
// 片段4: 通知用户以进入运行状态并启动桌面
    // 通知电量统计服务：当前用户已经启动运行了
    mBatteryStatsService.noteEvent(BatteryStats.HistoryItem.EVENT_USER_RUNNING_START,
            Integer.toString(mCurrentUserId), mCurrentUserId);
    mBatteryStatsService.noteEvent(BatteryStats.HistoryItem.EVENT_USER_FOREGROUND_START,
            Integer.toString(mCurrentUserId), mCurrentUserId);
    mSystemServiceManager.startUser(mCurrentUserId);

    synchronized (this) {
        if (mFactoryTest != FactoryTest.FACTORY_TEST_LOW_LEVEL) {
            ... // 省略测试相关的代码
        }
    }

    mBooting = true;
    // 关键调用1： 启动桌面
    startHomeActivityLocked(mCurrentUserId, "systemReady");

    .. // 省略与多用户相关的广播发送

    // 关键调用2： 将桌面Activity迁移到Resumed的状态
    mStackSupervisor.resumeTopActivitiesLocked();

    // 发送用户切换广播
    sendUserSwitchBroadcastsLocked(-1, mCurrentUserId);
} // END of systemRead()
{% endhighlight %}

以上代码片段是systemReady()函数的最后部分，一部分工作是发送通知：“当前用户已经进入使用状态了”； 另一部分工作就是启动桌面，有两处关键调用： **startHomeActivityLocked()**和**mStackSupervisor.resumeTopActivitiesLocked()**，在[Activity启动过程]()一文中，我们再详细分析涉及Activity启动的一系列函数。

**至此，systemReady()函数的执行逻辑已经分析完了，一共经历了4个步骤**

 - 片段1： 主要处理PRE_BOOT_COMPLETED广播;
 - 片段2： 杀掉在AMS准备就绪之前就已经启动的进程。因为这些进程要被AMS管理起来，需要在AMS准备就绪之后才启动;
 - 片段3： 主要任务是通知其他系统服务进入就绪状态。在AMS就绪完毕后，从SettingsProvider和本地文件中(urigrants.xml)读取一些配置信息。通知其他系统服务进入就绪状态，启动SystemUi;
 - 片段4： 主要任务是启动桌面。

systemReady()函数调用完成之后，桌面就可见了，用户就真正见到了Android系统的可操作界面。想必，各位读者心中还有一些困惑，不是开机会发送ACTION_BOOT_COMPLETED广播吗，桌面都已经启动了，怎么一直都没见到这个广播在哪发送？下面就给大家解惑。

### 2.3.3 发送ACTION_BOOT_COMPLETED广播

在桌面启动后，桌面进程主线程的消息队列进入空闲状态，此时会发起跨进程调用AMS.activityIdle()，紧接着会引发下面的调用关系：

    AMS.activityIdle()
    └── ActivityStackSupervisor.activityIdleInternalLocked()
        └── ActivityStackSupervisor.checkFinishBootingLocked()
            └── AMS.postFinishBooting() // 向主线程抛出FINISH_BOOTING_MSG消息
                └── AMS.MainHandler.handleMessage(FINISH_BOOTING_MSG)
                    └── AMS.finishBooting()

我们来看这一轮调用的落脚点AMS.finishBooting()函数：

{% highlight java %}
final void finishBooting() {
    // 如果开机动画没有显示完，则直接退出，等开机动画显示完后再调用
    synchronized (this) {
        if (!mBootAnimationComplete) {
            mCallFinishBooting = true;
            return;
        }
        mCallFinishBooting = false;
    }

    // ABI检查。ABI是Application Binary Interface的简称，与CPU的指令集相关。
    ArraySet<String> completedIsas = new ArraySet<String>();
    for (String abi : Build.SUPPORTED_ABIS) {
        .. // 省略ABI判断代码。如果ABI不支持，则退出，表示启动失败。
    }

    // 注册ACTION_QUERY_PACKAGE_RESTART广播
    IntentFilter pkgFilter = new IntentFilter();
    pkgFilter.addAction(Intent.ACTION_QUERY_PACKAGE_RESTART);
    pkgFilter.addDataScheme("package");
    mContext.registerReceiver(new BroadcastReceiver() {...//省略广播实现代码}, pkgFilter);

    // 注册ACTION_DELETE_DUMPHEAP广播
    IntentFilter dumpheapFilter = new IntentFilter();
    dumpheapFilter.addAction(DumpHeapActivity.ACTION_DELETE_DUMPHEAP);
    mContext.registerReceiver(new BroadcastReceiver() {...}, dumpheapFilter);

    // 通知系统启动已经进入最后阶段：PHASE_BOOT_COMPLETED
    mSystemServiceManager.startBootPhase(SystemService.PHASE_BOOT_COMPLETED);

    synchronized (this) {
        // 启动之前被“抑制启动”的进程，这些进程在AMS准备就绪之前，就已经准备要启动了，
        // 但又必须在AMS就绪之后启动，所以，就先放在mProcessesOnHold这个数组中
        // 现在，是时候真正启动这些进程了。
        final int NP = mProcessesOnHold.size();
        if (NP > 0) {
            ArrayList<ProcessRecord> procs = new ArrayList<ProcessRecord>(mProcessesOnHold);
            for (int ip=0; ip<NP; ip++) {
                startProcessLocked(procs.get(ip), "on-hold", null);
            }
        }

        if (mFactoryTest != FactoryTest.FACTORY_TEST_LOW_LEVEL) {
            // 抛出一个消息，用于检查是否有App滥用了WakeLock，即长时间不释放WakeLock
            Message nmsg = mHandler.obtainMessage(CHECK_EXCESSIVE_WAKE_LOCKS_MSG);
            mHandler.sendMessageDelayed(nmsg, POWER_CHECK_DELAY);

            // 写入一个系统属性，sys.boot_completed=1 表示系统启动完毕
            SystemProperties.set("sys.boot_completed", "1");

            // 发送ACTION_BOOT_COMPLETED广播
            for (int i=0; i<mStartedUsers.size(); i++) {
                UserState uss = mStartedUsers.valueAt(i);
                if (uss.mState == UserState.STATE_BOOTING) {
                    uss.mState = UserState.STATE_RUNNING;
                    final int userId = mStartedUsers.keyAt(i);
                    Intent intent = new Intent(Intent.ACTION_BOOT_COMPLETED, null);
                    intent.putExtra(Intent.EXTRA_USER_HANDLE, userId);
                    intent.addFlags(Intent.FLAG_RECEIVER_NO_ABORT);
                    broadcastIntentLocked(...);
            }

            // 调度性能统计
            scheduleStartProfilesLocked();
        }
    }
}
{% endhighlight %}

以上函数的逻辑不复杂，主要经过以下流程：进行ABI检查，注册一些系统广播，启动之前被抑制启动的进程，发送ACTION_BOOT_COMPLETED广播，调度性能统计功能。

# 3 总结

本章节分析了系统进程启动过程中与AMS相关的逻辑，总体而言，可以分为三步：

1. **初始化系统进程的运行环境**。所谓运行环境，就是指的Context，Context蕴含了代码执行过程中所需要的信息，包括进程信息、包信息、资源信息等等。Android有意弱化进程的概念，强化Context的概念，在Android编程时，一定避免不了与Context打交道。对于系统进程而言，Context有一定的特殊性，所以单独造了一个SystemContext。

2. **初始化AMS对象**。AMS对象在系统进程构建，作为最重要的系统服务，AMS初始化要做的事情非常多。由于各种系统服务耦合在一块，相互影响，Android设计了“系统进程启动阶段”这个概念，就像一个简单的状态机，只有进入的某个阶段，才能做某些操作。譬如，只有进入PHASE_ACTIVITY_MANAGER_READY，AMS才能正常工作，这时才可以进行派发广播、管理进程等操作。

    因为系统进程也在AMS的管辖范围之内，所以，AMS对象构建后有一个重要的任务，就是设置系统进程的一些属性。这时，会将第一个启动的应用frameworks-res.apk的信息装载到系统进程中，创建一个系统进程的ProcessRecord对象以便AMS管理。

3. **AMS初始化的配套工作**。这里所谓配套工作是指，系统要完全运行起来，还需要经由AMS进行一系列的运作：系统设置SettingsProvider会经由AMS装载到系统进程中；其他系统服务在AMS准备就绪后，也会进入就绪状态，表示可以正常工作；桌面会经由AMS启动，最终ACTION_BOOT_COMPLETED广播发出。
