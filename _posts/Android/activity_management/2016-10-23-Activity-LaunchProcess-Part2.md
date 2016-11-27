---
layout: post
category: Android启智观
title: Android四大组件之Activity--启动过程(下)
tagline:
tags:  [Activity管理机制]
---

在[Activity的启动过程(上)](2016-07-29-Activity-LaunchProcess-Part1)一文中，我们介绍了Activity启动过程的上半部分，
按照Activity的启动时序，涉及内容到多达11个函数，最终落脚点在创建一个应用进程。Activity启动过程的上半部分都还是在系统进程中完成，是系统进程内部数据结构和状态的调整。本文分析Activity启动过程的下半部分，涉及到系统进程和应用进程的通信，建议读者先读完[应用进程与系统进程的通信](2016-01-29-Activity-IPC)，了解两个进程的通信方式。

本文还是像Activity启动过程(上)一样，以Activity的启动时序为主线，以函数为段落进行分析。

# 概览

当Zygote创建完一个应用进程之后，得到的仅仅是一个可以运行的载体，Android还没有侵入到这个新创的进程之中。在[ActivityManagerService的启动过程](2016-07-15-AMS-LaunchProcess)一文中，我们介绍过，当系统进程创建以后，还需要创建一个运行环境，就是Context，然后再装载Provider信息，这才是一个可以完整的Android进程。对于应用进程而言，也需要经历这个过程，本文分析的起点，就是Android应用进程的创建。

先上最上层的时序图：

<div align="center"><img src="/assets/images/activity/launchprocess/3-activity-launchprocess-sequence-diagram.png" alt="Sequence Diagram"/></div>

在这个时序图中，ActivityThread运行在应用进程，代表主线程；AMS、ASS、ProcessRecord都是系统进程中的对象，两个进程需相互通信，配合完成Activity启动接下来的过程。下面，我们就一一来解析时序图中重要的函数。

# 1. ActivityThread.main()

该函数是一个静态方法，在创建应用进程时，会被反射调用。

{% highlight java %}
public static void main(String[] args) {
    ... // 省略一些初始化代码
    Process.setArgV0("<pre-initialized>");
    // 初始化主线程的消息队列
    Looper.prepareMainLooper();

    ActivityThread thread = new ActivityThread();
    thread.attach(false);
    if (sMainThreadHandler == null) {
        sMainThreadHandler = thread.getHandler();
    }
    // 消息队列开始循环
    Looper.loop();

    // 如果消息队列退出循环，则抛出异常
    throw new RuntimeException("Main thread loop unexpectedly exited");
}
{% endhighlight %}

该函数的职能是初始化应用进程的主线程，主线程会有一个消息队列，当消息队列开始循环时，便不断从获取消息处理。

我们通常说，ActivityThread就是应用进程的主线程，这其实是一种笼统的说法，其实ActivityThread并非真正意义上的线程，它不是Thread的子类，只不过ActivityThread充当了主线程的职能，它初始化了一个消息队列。在ActivityThread对象构建时，会创建一个Handler对象，这个Handler对象所绑定的消息队列就是主线程的消息队列。ActivityThread对象构建后，会调用自身的**attach()**函数，发起一个绑定操作。

# 2. ActivityThread.attach(false)

在[ActivityManagerService的启动过程](2016-07-15-AMS-LaunchProcess)一文中，曾经见过这个函数，系统进程启动时，也会调用该函数，不过系统进程给的参数system是true，而这里给的参数是false，表示为应用进程发起的绑定操作。

{% highlight java %}
private void attach(boolean system) {
    sCurrentActivityThread = this;
    mSystemThread = system;
    if (!system) {
        // 设置进程名。此时，还没有ApplicationInfo，所以用<pre-initialized>来命名应用进程
        android.ddm.DdmHandleAppName.setAppName("<pre-initialized>",
                                                UserHandle.myUserId());
        RuntimeInit.setApplicationObject(mAppThread.asBinder());
        final IActivityManager mgr = ActivityManagerNative.getDefault();
        try {
            mgr.attachApplication(mAppThread);
        } catch (RemoteException ex) { // Ingore }

        BinderInternal.addGcWatcher(...)
        DropBox.setReporter(new DropBoxReporter());
        ViewRootImpl.addConfigCallback(...)
    } else {
    	... // 省略系统进程的绑定操作
    }
}
{% endhighlight %}

该函数完成一些简单的初始化操作，关键点在于通过IActivityManager发起跨进程调用attachApplication(mAppThread)，这里传递的参数mAppThread是一个Binder类型的对象，因此可以作为跨进程传递的参数。mAppThread对象存在于应用进程，但会被传递到系统进程，在系统进程看来，mAppThread就是操作应用进程的一个工具。后续，系统进程如果想要向应用进程发起跨进程调用，也都需要通过mAppThread这个对象。

# 3. AMS.attachApplicationLocked()

系统进程中，响应**IActivityManager.attachApplication(mAppThread)**的服务就是AMS了，该函数会在一个Binder线程中执行。

{% highlight java %}
private final boolean attachApplicationLocked(IApplicationThread thread,
        int pid) {
    ProcessRecord app;

    // 根据PID映射应用进程的ProcessRecord对象
    if (pid != MY_PID && pid >= 0) {
        synchronized (mPidsSelfLocked) {
            app = mPidsSelfLocked.get(pid)
        }
    } else {
        app = null;
    }
    if (app == null) {
        // 获取ProcessRecord对象失败，则做一些清理操作后退出
        if (pid > 0 && pid != MY_PID) {
            Process.killProcessQuiet(pid)
        } else {
            thread.scheduleExit();
        }
        return false;
    }

    if (app.thread != null) {
        // ProcessRecord对象之前绑定的进程还则，而当下需要将ProcessRecord绑定到一个新的进程
        // 所以需要将之前ProcessRecord所绑定的进程信息清除
        handleAppDiedLocked(app, true, true);
    }

    final String processName = app.processName;
    try {
    	// 注册应用进程的DeathRecipient，当应用进程崩溃时，系统进程可以收到通知
        AppDeathRecipient adr = new AppDeathRecipient(
                app, pid, thread);
        thread.asBinder().linkToDeath(adr, 0);
        app.deathRecipient = adr;
    } catch (RemoteException e) {
        app.resetPackageList(mProcessStats);
        startProcessLocked(app, "link fail", processName);
        return false;
    }

	// 将ProcessRecord对象绑定到应用进程，这是ProcessRecord就变成了“激活”状态
    app.makeActive(thread, mProcessStats);
    app.curAdj = app.setAdj = -100;
    app.curSchedGroup = app.setSchedGroup = Process.THREAD_GROUP_DEFAULT;
    app.forcingToForeground = null;
    updateProcessForegroundLocked(app, false, false);
    app.hasShownUi = false;
    app.debugging = false;
    app.cached = false;
    app.killedByAm = false;

    mHandler.removeMessages(PROC_START_TIMEOUT_MSG, app);

    boolean normalMode = mProcessesReady || isAllowedWhileBooting(app.info);
    // 获取应用进程的所有Provider
    List<ProviderInfo> providers = normalMode ? generateApplicationProvidersLocked(app) : null;

    try {
        ... // 省略debug和性能相关的代码
        // 发起跨进程调用，将一堆的信息传递给应用进程
        thread.bindApplication(processName, appInfo, providers, app.instrumentationClass,
            profilerInfo, app.instrumentationArguments, app.instrumentationWatcher,
            app.instrumentationUiAutomationConnection, testMode, enableOpenGlTrace,
            isRestrictedBackupMode || !normalMode, app.persistent,
            new Configuration(mConfiguration), app.compat,
            getCommonServicesLocked(app.isolated),
            mCoreSettingsObserver.getCoreSettingsLocked());
        updateLruProcessLocked(app, false, null);
    } catch (Exception e) {...}

    mPersistentStartingProcesses.remove(app);
    mProcessesOnHold.remove(app);

    boolean badApp = false;
    boolean didSomething = false;
    if (normalMode) {
        try {
            // 调度Activity
            if (mStackSupervisor.attachApplicationLocked(app)) {
                didSomething = true;
            }
        } catch (Exception e) {
            badApp = true;
        }
    }

    if (!badApp) {
        try {
            // 调度Service
            didSomething |= mServices.attachApplicationLocked(app, processName);
        } catch (Exception e) {
            badApp = true;
        }
    }

    if (!badApp && isPendingBroadcastProcessLocked(pid)) {
        try {
            // 调度Broadcast
            didSomething |= sendPendingBroadcastsLocked(app);
        } catch (Exception e) {
            badApp = true;
        }
    }

    if (!badApp && mBackupTarget != null && mBackupTarget.appInfo.uid == app.uid) {
        ... // 省略Backup相关的代码
    }

    if (badApp) {
        app.kill("error during init", true);
        handleAppDiedLocked(app, false, true);
        return false;
    }

    if (!didSomething) {
        updateOomAdjLocked();
    }

    return true;
}
{% endhighlight %}

该函数的实现逻辑如下：

- 获取ProcessRecord对象。通过Binder.getCallingPid()可以获取Binder接口的调用者所在进程的PID
进一步，通过PID，就能获取到应用进程对应的ProcessRecord。如果ProcessRecord对象获取失败，则表示应用进程已经被杀掉，需要清除应用进程的数据；如果ProcessRecord之前所绑定的进程信息还在，则需要清除这些信息；

- 为应用进程注册AppDeathRecipient，它是存在于系统进程的对象，当应用进程被杀掉的时候，系统进程会收到通知；

- 激活ProcessRecord对象。所谓“激活”，就是ProcessRecord已经绑定到了一个应用进程，绑定的标识就是：应用进程的ApplicationThread对象赋值给ProcessRecord.thread变量；

- 获取应用进程中所有注册的Provider，这需要通过PackageManager来扫描进程所关联的包名，所有静态的Provider信息，即ProviderInfo对象，都会保存到**ProcessRecord.pubProviders**变量中;

  > 在系统进程启动时，也曾经历过这个过程，系统进程对应的包名是"android"，扫描的是framework-res.apk的这个应用的信息。

- 进行一些调试与性能相关的变量设置之后，通过**IApplicationThread.bindApplication()**发起跨进程调用，这样一来，诸如进程名、ApplicationInfo等信息就传递给应用进程了；

- 将信息传递给应用程序以后，就可以进行调度了。这里通过两个标识来记录调度的情况：badApp标识是否调度失败，默认为false，在依次调度Activity、Service和Broadcast的过程中，根据实际的情况，可能将其调整为true，表示调度失败了。一旦调度失败，则需要杀掉应用进程；didSomething表示确有调度发生。在后文中，我们将着重分析Activity的调度，即**ASS.attachApplicationLocked()**函数。

# 4. ActivityThread.handleBindApplication()

系统进程通过**IApplicationThread.bindApplication()**向应用进程传递数据，应用进程中，ApplicationThread会在Binder线程中响应这个跨进程调用，进行一些简单的数据封装后，便向主线程抛出一个**BIND_APPLICATION**消息，这样一来，真正完成进程绑定的操作是在主线程的**handleBindApplication()**函数中。

{% highlight java %}
private void handleBindApplication(AppBindData data) {
    ... // 省略部分数据初始化代码

    // 虽然应用进程早就已经创建，但直到这时，才知道进程名是什么
    Process.setArgV0(data.processName);
    android.ddm.DdmHandleAppName.setAppName(data.processName, UserHandle.myUserId());

    ... // 省略部分进程运行信息设置代码

	// 创建应用进程的Android运行环境：Context
    final ContextImpl appContext = ContextImpl.createAppContext(this, data.info);
    if (!Process.isIsolated()) {
        ... // 省略与缓冲目录设置相关的代码
    }

    ... // 省略应用进程相关的初始化代码，包含时区、StrictMode、调试模式等相关的设置

    // 根据情况初始化Intrumentation对象
    if (data.instrumentationName != null) {
        ...
        try {
            java.lang.ClassLoader cl = instrContext.getClassLoader();
            mInstrumentation = (Instrumentation)
                cl.loadClass(data.instrumentationName.getClassName()).newInstance();
        } catch (Exception e) { ... }

        mInstrumentation.init(this, instrContext, appContext,
                new ComponentName(ii.packageName, ii.name), data.instrumentationWatcher,
                data.instrumentationUiAutomationConnection);
        ...
    } else {
        mInstrumentation = new Instrumentation();
    }
    ...
    try {
        // 创建Application对象
        Application app = data.info.makeApplication(data.restrictedBackupMode, null);
        mInitialApplication = app;

		// 装载Providers
		if (!data.restrictedBackupMode) {
            List<ProviderInfo> providers = data.providers;
            if (providers != null) {
                installContentProviders(app, providers);
                ...
            }
        }

        mInstrumentation.onCreate(data.instrumentationArgs);

        // 调用Application.onCreate()函数
        mInstrumentation.callApplicationOnCreate(app);
    }
    ...
}
{% endhighlight %}

系统进程已经将很多与应用程序相关的信息都传递给到此，所以该函数的职能就是初始化一个Android应用程序的运行信息。以下过程与系统进程的初始化一样：

- 创建Android运行环境Context；

- 创建Instrumentation对象；

- 创建Application对象。通过**LoadedApk.makeApplication()**函数，就能创建一个Application对象；

- 装载Providers。有了一个静态的ProviderInfo列表，但应用进程的ContentProvider还不能真正工作，因为ContentProvider对象还未创建。**ActivityThread.installContentProviders()**函数就是用来创建ContentProvider对象的。由此可见，在**Application.onCreate()**函数调用之前，进程的**ContentProvider**都已经创建完毕了；

- 调用**Application.onCreate()**函数。这个函数就是我们通常要实现的系统回调函数。

> Android应用程序需要一个可以运行的进程，这个进程的创建需要通过某种手段通知系统进程，譬如启动Activity，从而引发Zygote孵化出一个应用进程；
>
> 刚出生的应用进程来到Android的世界，还什么都不懂，甚至连个正经儿的名字都没有，这时，应用进程极需要将自己加入到Android的社会关系中。应用进程知道，在Android世界中，有一个中心进程，即系统进程，运行在系统进程中有一个管理者，即AMS。所以，应用进程就向AMS发起了“绑定”请求；
>
> AMS在收到“绑定”请求后，迅速了解到情况，知道应用进程因何而来，为何而去，把应用进程需要生存下去的信息传递给它，譬如ApplicationInfo，PrivderInfo等；
>
> 应用进程在收到系统进程的反馈之后，开始自我成长，有了进程名，构建出Android的运行环境，真正有了Android应用程序的概念，即Application，这时候应用进程才真正在Android的世界立足。

<b><font color="red">至此，第一个阶段已经分析完毕，完成了一个普通的进程到Android进程的蜕变。</font></b>

# 5. ASS.attachApplicationLocked()

该函数取名为**attachApplication()**，意在将ASS绑定到应用进程，那么，ASS有什么需要被绑定到一个应用进程呢？当然是AcivityRecord了。

启动HomeActivity创建了一个新的ActivityRecord，并将其挪到了HomeStack的栈顶位置，当时，ActivityRecord还没有关联到任何进程相关的信息，还不能被迁移到显示状态。当应用进程被创建之后，Activity才有了运行的机会，这时候才会真正调度ActivityRecord。

{% highlight java %}
boolean attachApplicationLocked(ProcessRecord app) throws RemoteException {
    final String processName = app.processName;
    boolean didSomething = false;
    for (int displayNdx = mActivityDisplays.size() - 1; displayNdx >= 0; --displayNdx) {
        ArrayList<ActivityStack> stacks = mActivityDisplays.valueAt(displayNdx).mStacks;
        for (int stackNdx = stacks.size() - 1; stackNdx >= 0; --stackNdx) {
            final ActivityStack stack = stacks.get(stackNdx);
            if (!isFrontStack(stack)) {
                continue;
            }
            ActivityRecord hr = stack.topRunningActivityLocked(null);
            if (hr != null) {
                if (hr.app == null && app.uid == hr.info.applicationInfo.uid
                        && processName.equals(hr.processName)) {
                    try {
                        if (realStartActivityLocked(hr, app, true, true)) {
                            didSomething = true;
                        }
                    } catch (RemoteException e) { ... }
                }
            }
        }
    }
    if (!didSomething) {
        ensureActivitiesVisibleLocked(null, 0);
    }
    return didSomething;
}
{% endhighlight %}

该函数的实现逻辑与很多ASS的其他函数都类似：遍历寻找所有ActivityStack和TaskRecord，对栈顶的ActivityRecord进行操作。这里其实就是需要启动应用进程中还未启动的Activity。

# 6. ASS.realStartActivityLocked()

其实该函数并没有展开分析的必要，从其函数取名来看，是要动真格的了，什么才叫真正启动一个Activity呢？
我们可以理解为：调度**Activity.onCreate()**函数执行了，就算是真正启动Activity。

这里我们只把该函数的关键代码展示出来：

{% highlight java %}
final boolean realStartActivityLocked(ActivityRecord r,
        ProcessRecord app, boolean andResume, boolean checkConfig)
        throws RemoteException {
    ...
    r.app = app;
    app.waitingToKill = null;
    r.launchCount++;
    r.lastLaunchTime = SystemClock.uptimeMillis();
    ...
    app.thread.scheduleLaunchActivity(new Intent(r.intent), r.appToken,
            System.identityHashCode(r), r.info, new Configuration(mService.mConfiguration),
            new Configuration(stack.mOverrideConfig), r.compat, r.launchedFromPackage,
            task.voiceInteractor, app.repProcState, r.icicle, r.persistentState, results,
            newIntents, !andResume, mService.isNextTransitionForward(), profilerInfo);
    ...
    if (andResume) {
        stack.minimalResumeActivityLocked(r);
    }
    ...
}
{% endhighlight %}

关键点有三：

- 将ProcessRecord和ActivityRecord关联。ActivityRecord对象的app属性，就是ProcessRecord类型；

- 跨进程调用**IApplicationThread.scheduleLaunchActivity()**，调度启动Activity。很多参数都会通过这个函数传递到应用进程；

- 调用**AS.minimalResumeActivityLocked()**来显示Activity。

# 7. ActivityThread.handleLaunchActivity()

应用进程在收到系统进程发起的scheduleLaunchActivity()请求后，便开始驱动Activity生命周期的运转了。

该函数的主要职能就是触发Activity生命周期的开始。代码片段如下：

{% highlight java %}
private void handleLaunchActivity(ActivityClientRecord r, Intent customIntent) {
    unscheduleGcIdler();
    mSomeActivitiesChanged = true;

	if (r.profilerInfo != null) {
        mProfiler.setProfiler(r.profilerInfo);
        mProfiler.startProfiling();
    }

	handleConfigurationChanged(null, null);
    WindowManagerGlobal.initialize();
    Activity a = performLaunchActivity(r, customIntent);
    if (a != null) {
        r.createdConfig = new Configuration(mConfiguration);
        Bundle oldState = r.state;
        handleResumeActivity(r.token, false, r.isForward,
                !r.activity.mFinished && !r.startsNotResumed);

        if (!r.activity.mFinished && r.startsNotResumed) {
            ...
        }
    } else {
        try {
            ActivityManagerNative.getDefault()
                .finishActivity(r.token, Activity.RESULT_CANCELED, null, false);
        } catch (RemoteException ex) { ... }
    }
}
{% endhighlight %}

在进行了一些参数设置后，便调用**ActivityThread.performLaunchActivity()**函数，可以猜到初始化一个Activity，真正干活的是它。如果初始化成功，便调用**ActivityThread.handleResumeActivity()**来处理Activity进入显示状态时需要完成的操作；如果初始化失败，则发起跨进程调用**IActivityManager.finishActivity()**，来通报结束一个Activity的生命周期。

# 8. ActivityThread.performLaunchActivity()

该函数负责实际执行应用进程中Activity的启动，是系统进程调度启动一个Activity的落脚点，是Activity生命周期的开始。

{% highlight java %}
private Activity performLaunchActivity(ActivityClientRecord r, Intent customIntent) {
    // 准备新建一个Activity对象的参数
    ActivityInfo aInfo = r.activityInfo;
    if (r.packageInfo == null) {
        r.packageInfo = getPackageInfo(aInfo.applicationInfo, r.compatInfo,
                Context.CONTEXT_INCLUDE_CODE);
    }

    ComponentName component = r.intent.getComponent();
    if (component == null) {
        component = r.intent.resolveActivity(
            mInitialApplication.getPackageManager());
        r.intent.setComponent(component);
    }
    if (r.activityInfo.targetActivity != null) {
        component = new ComponentName(r.activityInfo.packageName,
                    r.activityInfo.targetActivity);
    }

	// 反射新建一个Activity对象
    Activity activity = null;
    try {
        java.lang.ClassLoader cl = r.packageInfo.getClassLoader();
        activity = mInstrumentation.newActivity(
                cl, component.getClassName(), r.intent);
        ...
    } catch (Exception e) { ... }

	// 创建Activity的Context，并将数据绑定到Activity对象
    try {
        Application app = r.packageInfo.makeApplication(false, mInstrumentation);
        if (activity != null) {
            Context appContext = createBaseContextForActivity(r, activity);
            CharSequence title = r.activityInfo.loadLabel(appContext.getPackageManager());
            Configuration config = new Configuration(mCompatConfiguration);
            activity.attach(appContext, this, getInstrumentation(), r.token,
                    r.ident, app, r.intent, r.activityInfo, title, r.parent,
                    r.embeddedID, r.lastNonConfigurationInstances, config,
                    r.referrer, r.voiceInteractor);
        }
        ...
        // 回调Activity.onCreate()函数
        if (r.isPersistable()) {
            mInstrumentation.callActivityOnCreate(activity, r.state, r.persistentState);
        } else {
            mInstrumentation.callActivityOnCreate(activity, r.state);
        }
        ...
        // 回调Activity.onStart()函数
        if (!r.activity.mFinished) {
            activity.performStart();
            r.stopped = false;
        }
        ...
    } catch(...) {}

    return activity;
}
{% endhighlight %}

关键代码逻辑如下：

- 初始化一些参数。一个新的Activity对象，是通过反射创建的，所以需要包名、类名等信息，部分信息已经从系统进程传递到应用进程了，部分信息也都可以通过PackageManager再向系统进程索取；

- 新建一个Activity对象。有了参数以后，便可以通过ClassLoader加载到Activity对应的类，反射构建之。以上代码片省略了一个细节，就是Activity的Context、Theme会在Activity对象构建之后被初始化；

- 调用**Activity.onCreate()**函数。Activity对象有了，便可以开始完成其使命，于是大家耳熟能详的**Activity.onCreate()**函数此刻便被唤起，Actiivty进入其生命周期的开始。

- 调用**Activity.onStart()**函数。Activity生命周期紧锣密鼓的进入下一个阶段，另外一个重要的函数也随之而来；

> 读到Activity启动过程这个函数，想必各位读者都叹为观止，这是经历了多长一段路，才总算到**Activity.onCreate()**这个函数啊！原来我们在这个函数里面加几行代码，是经过了这样一番曲折的过程才会被执行！
>
> Activity生命函数就像是Activity调度过程的冰山一角，对于做应用层的开发人员而言，只需要看到最外层的冰山，就能栩栩如生地把冰山的样子转述出来；然而，意想不到的是，冰山底下宏大的世界，撑起整座冰山的根基却是如此的复杂。

# 9. ActivityThread.handleResumeActivity()

在Activity对象构建成功，并成功走完onCreate(), onStart()两个生命周期函数之后，便进入到这个阶段：Activity要进入onResume()的这个生命周期：

{% highlight java %}
final void handleResumeActivity(IBinder token,
        boolean clearHide, boolean isForward, boolean reallyResume) {
    unscheduleGcIdler();
    mSomeActivitiesChanged = true;

    // 实际执行应用进程一侧的Activity.onResume()
    ActivityClientRecord r = performResumeActivity(token, clearHide);
    if (r != null) {
        ... // 省略与WindownManager相关的窗口操作
        if (reallyResume) {
            // 通知系统进程，Activity已经处于Resumed状态
            ActivityManagerNative.getDefault().activityResumed(token);
        }
    }
}
{% endhighlight %}

真正调用生命周期的是**performResumeActivity()**函数，本文不展开分析了。有一点需要读者注意：在调用**onResume()**之前，如果Activity已经处于Stopped状态，则会先调用**onRestart()**函数，在**performResumeActivity()**函数中，读者可以找到这部分逻辑。

当应用进程已经走完**onResme()**之后，便可通知系统进程：Activity已经进入Resumed状态了，这是通过调用**IActivityManager.activityResumed()**函数实现的，我们后文会再分析此函数。

如果没有进一步的用户输入，那Activity就会在Resumed状态驻留了。

<b><font color="red">至此，第二个部分分析完毕，干了一个大事：启动Activity到显示状态。</font></b>
