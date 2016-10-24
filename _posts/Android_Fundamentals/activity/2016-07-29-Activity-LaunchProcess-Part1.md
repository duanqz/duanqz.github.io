---
layout: post
category: Android系统原理
title: Android四大组件之Activity--启动过程(上)
tagline:
tags:  [Android四大组件]
---

Activity的启动过程涉及到的逻辑非常庞大，很难做到单点突破，建议读者在读本文之前，把[Activity的四种启动模式](2016-01-21-Activity-LaunchMode)、[ActivityManagerService的启动过程](2016-07-15-AMS-LaunchProcess.md)、[Activity的管理方式](2016-02-01-Activity-Maintenance)都再读一遍，储存一些背景知识。也是由于内容太多，笔者把启动过程分为上、下两部分介绍，另外一部分在[Activity的启动过程(下)](2016-10-23-Activity-LaunchProcess-Part2.md)一文中。

为了尽量能够把Activity启动的主线流程呈现出来，本文选择HomeActivity的启动过程进行分析，按照启动过程中函数的调用时序，以每个关键函数为段落进行分析。
之所以要挑选HomeActivity，是因为它是起机后第一个要启动的Activity，很多状态都处于初始条件，能够简化分析过程。
之所以要以函数为段落进行分析，是因为启动过程本来就是一个时序，哪个时间点，进入哪个函数，完成哪些事，是本文想要分析重点。

通过阅读本文，能够深入理解Activity启动过程中的关键节点以及关键事件。但不得不说，Activity启动的场景非常多，远非本文的篇幅能够涵盖，读者应该结合自身的工作环境，来探究在不同场景下Activity启动所经过的路径。

# 概述

HomeActivity就是桌面的主屏，其Category为CATEGORY_HOME。在[ActivityManagerService的启动过程](2016-07-15-AMS-LaunchProcess)一文中，我们分析过在ActivityManagerService准备就绪的最后，即systemReady()函数的最后部分，就会启动桌面，实际上就是要求启动HomeActivity。

本章分析的对象就是HomeActivity的启动过程，先上一个最上层的时序图：

<div align="center"><img src="/assets/images/activity/launchprocess/1-activity-launchprocess-sequence-diagram.png" alt="Sequence Diagram"/></div>

我们先树立个顶层的概念：Activity的调度由AMS完成，AMS以栈式结构管理者所有的Activity，直接管理Activity的栈称为TaskRecord，后文中会用“任务”来表述这个栈；管理任务的栈称为ActivityStack；在ActivityStack之上还有一个管理者ActivityStackSupervisor。Activity的启动过程就是AMS对栈结构进行调整的过程，Activity的各级管理者都会参与进来，各司其职。

> 阅读过早期Android源码的读者可能知道，Android最开始对Activity调度的设计并没有像现在这么复杂，例如ActivityStackSupervisor是到支持多屏显示才出现的，还有诸如多窗口的实现，也是直到Android 6.0才出现的。Android不断在更迭，保持自身活力，适应新的需求。

# 1. AMS.startHomeActivityLocked()

这是启动HomeActivity的第一个函数，这时候，系统进程(system_server)才刚刚启动完毕(systemReady)，第一个要启动的Activity就是HomeActivity，意味着要让用户看到手机的主屏，又称之为桌面。

{% highlight java %}
boolean startHomeActivityLocked(int userId, String reason) {
    if (mFactoryTest == FactoryTest.FACTORY_TEST_LOW_LEVEL
          && mTopAction == null) {1-activity-launchprocess-sequence-diagram.png
        // 工厂测试模式，而且找到ACTION_FACTORY_TEST，则启动失败
        return false;
    }

    // 获取一个Home Intent，交由PackageManager解析出ActivityInfo
    Intent intent = getHomeIntent();
    ActivityInfo aInfo = resolveActivityInfo(intent, STOCK_PM_FLAGS, userId);
    if (aInfo != null) {
        // 找到目标Activity，设置Activity启动参数
        intent.setComponent(new ComponentName(
            aInfo.applicationInfo.packageName, aInfo.name));
        aInfo = new ActivityInfo(aInfo);
        aInfo.applicationInfo = getAppInfoForUser(aInfo.applicationInfo, userId);
        ProcessRecord app = getProcessRecordLocked(aInfo.processName,
                aInfo.applicationInfo.uid, true);
        if (app == null || app.instrumentationClass == null) {
            // 桌面进程还未启动，则启动HomeActivity
            intent.setFlags(intent.getFlags() | Intent.FLAG_ACTIVITY_NEW_TASK);
            mStackSupervisor.startHomeActivity(intent, aInfo, reason);
        }
    }

    return true;
}
{% endhighlight %}

以上函数的主体逻辑是：

- 通过PackageManager解析出可以处理HomeIntent的Activity，这里的HomeIntent其实就是一个设置了Category为CATEGORY_HOME的Intent；

- 如果找到，则需要通过Intent启动目标Activity。这时候，需要把包名信息设置到Intent中。启动Activity之前，会从解析到ActivityInfo中获取Activity所属的进程信息，在第一次启动HomeActivity时，宿主进程显然还没有创建，所以，接下来的逻辑转到了ActivityStackSupervisor(下文简称ASS)中，这会经过一个无比的漫长的旅途。

# 2. ASS.startHomeActivity()

ASS接收Activity启动的控制权后，就开始彰显其精密的调度手段了。
到这一步，HomeActivity的静态信息(Intent, ActivityInfo)已经准备好了，接下来，就是要把Activity的静态信息注入到一个动态的运行环境中。

{% highlight java %}
void startHomeActivity(Intent intent, ActivityInfo aInfo, String reason) {
    moveHomeStackTaskToTop(HOME_ACTIVITY_TYPE, reason);
    startActivityLocked(null /* caller */, intent, null /* resolvedType */, aInfo,
        null /* voiceSession */, null /* voiceInteractor */, null /* resultTo */,
        null /* resultWho */, 0 /* requestCode */, 0 /* callingPid */, 0 /* callingUid */,
        null /* callingPackage */, 0 /* realCallingPid */, 0 /* realCallingUid */,
        0 /* startFlags */, null /* options */, false /* ignoreTargetSecurity */,
        false /* componentSpecified */,
        null /* outActivity */, null /* container */,  null /* inTask */);
    if (inResumeTopActivity) {
        scheduleResumeTopActivities();
    }
}
{% endhighlight %}

以上函数有牵扯到3个函数调用：

- **moveHomeStackTaskToTop()**: 目的是为了把HomeActivity挪到任务顶；HomeStack就是HomeActivity所在的任务；

- **startActivityLocked()**：这会进入启动Activity的漫长过程；注意这里给的参数大部分为null或者0，表示HomeActivity是系统中启动的第一个Activity，它由系统进程启动；如果是由普通的应用进程启动一个Activity，那这些参数都应该赋值为当前Activity的唤起者信息；

- **resumeTopActivityLocked()**：在**ASS.inResumeTopActivity**这个变量的控制下调用，因为resumeTopActivityLocked()可能被多次调用，所以通过该变量来避免重复执行函数逻辑。对于本例中第一次进入，**ASS.inResumeTopActivity**为false，所以并不会触发调度resumeTopActivityLocked()函数，在后文，我们会再次见到这个函数，届时再深入分析。

在HomeActivity启动之前，就需要将，来看**moveHomeStackTaskToTop()**这个函数的具体实现:

{% highlight java %}
boolean moveHomeStackTaskToTop(int homeStackTaskType, String reason) {
    if (homeStackTaskType == RECENTS_ACTIVITY_TYPE) {
         // 如果要显示的类型是最近任务列表，则调用WindowManagerService将其显示
         mWindowManager.showRecentApps();
         return false;
    }

    // 调用ActivityStack的函数，完成实际的HomeStack挪动
    // 想必读者心中已生疑问，在HomeActivity启动之前就已经有了HomeStack，
    // 那么，HomeStack是在什么时候创建的呢？
    mHomeStack.moveHomeStackTaskToTop(homeStackTaskType);
    final ActivityRecord top = getHomeActivity();
    if (top == null) {
        return false;
    }

    mService.setFocusedActivityLocked(top, reason);
    return true;
}
{% endhighlight %}

该函数仅仅是做一些上层的调用，牵扯到两个概念：HomeStack和HomeTask。 HomeTask就是HomeActivity的宿主任务，HomeStack就是HomeTask所在的栈。该函数的目的就是为了将HomeTask挪到HomeStack的栈顶位置，为后面的HomeActivity启动做准备。

**然而，这里有一个值得读者思考的地方，HomeStack是在什么时候创建的？此刻HomeStack里面有些什么内容呢？**

其实，早在系统进程启动时候，就已经创建了HomeStack对象：

    SystemServer.startOtherService()
    └── AMS.setWindowManager()
        └──  ASS.setWindowManager()
             └── ASS.createStackOnDisplay(HOME_STACK_ID, Display.DEFAULT_DISPLAY);

- SystemServer中启动时会创建WindowManagerService(后文简称WMS)；
- AMS的很多调度逻辑都需要与WMS进行交互，所以需要将WMS对象设置到AMS中；
- ASS也需要WMS对象，所以进一步将WMS设置到ASS中；
- ASS在获取到WMS对象之后，就可以创建ActivityStack了，因为ActivityStack需要绑定到显示设备上。
  每一个ActivityStack都有一个编号，HomeStack的编号是HOME_STACK_ID(0)，它是绑定到默认的显示设备上的，即手机屏幕。

下面的函数调用本意是将HomeStack中，类型为HOME_ACTIVITY_TYPE(1)的任务挪到HomeStack的栈顶位置：

{% highlight java %}
void moveHomeStackTaskToTop(int homeStackTaskType) {
    final int top = mTaskHistory.size() - 1;
    for (int taskNdx = top; taskNdx >= 0; --taskNdx) {
        final TaskRecord task = mTaskHistory.get(taskNdx);
        if (task.taskType == homeStackTaskType) {
            mTaskHistory.remove(taskNdx);
            mTaskHistory.add(top, task);
            updateTaskMovement(task, true);
            return;
        }
    }
}
{% endhighlight %}

ActivityStack中用TaskHistory数组记录了所有的任务，要将HomeTask挪到栈顶的位置，就是先找到HomeTask，然后将其删除，再在栈顶的位置添加一个新的HomeTask。

这里还调用了updateTaskMovement()函数，这个函数在后文还会见到很多次，其实并没有什么特别的地方，只是针对Persistable的任务，记录一个时间，这个时间在恢复任务的时候会用到。

实际上，此时的HomeStack，栈中什么都没有，TaskHistory数组的长度为0，HomeTask这个时候还没创建呢，所以，以上分析的函数逻辑并不会执行。正是由于HomeStack中还什么都没有，接下来的getHomeActivity()也会返回null，也就不会调用**AMS.setFocusedActivityLocked()**，但该函数非常重要，会在后文中被调用的。

该函数的逻辑其实是为其他Activity切换到HomeActivity设计的，第一次启动HomeActivity的时候，大部分逻辑都不会走到。接下来，才是Activitiy启动的重头戏。

<b><font color="red">至此，HomeActivity启动过程的第一个大部分已经分析完毕，完成两件大事：其一是构建HomeIntent，其二是调度HomeStack。</font></b>

***

# 3. ASS.startActivityLocked()

Activity启动的旅途由此就开启了，这个过程无比的繁杂，涉及到的函数逻辑都很庞大。每一个Activity的启动都会经过这个函数调用，由于Activity本身的启动模式、宿主任务的状态、宿主进程的状态都会影响到Activity的启动过程，所以中间的判断分支非常多，就本例中的HomeActivity启动而言，相比一般的Activity启动会简单很多，是一个比较好的入门案例。

先来介绍一下函数入参的意义：

函数入参 | 描述
---|---
caller | 调用者进程的操作接口。本例中，该参数被设置为null。
intent | 启动当前Activity的Intent。
revolvedType | Intent的解析类型。本例中为null。
aInfo | Activity的静态信息类，解析AndroidManifest.xml的&lt;activity&gt;得到的数据结构。
voiceSession，voiceInteractor | 语音相关的接口。本例中均为null。
resultTo | 调用者Activity。本例为null，但通常情况下，该参数都不为null，因为一个Activity通常由另外一个Activity启动。HomeActivity相当于一个初始的Activity。
resultWho | 描述调用者Activity的字符串。与resultTo是配套存在的，本例为null。
requestCode | 请求码。当调用者Activity需要获取待启动Activity的数据时，可以设置该参数来启动Activity，通过Activity.startActivityForResult()便可传入requestCode参数，取一个大于或等于0的整数即可。默认情况下为"-1"，启动HomeActivity时，该参数为"0"。
callingPid，callingUid | 调用者的进程号和用户号。本例中均为0，表示从系统进程中启动Activity
callingPackage | 调用者包名。本例中为null，表示系统进程。
realCallingPid，realCallingUid |
startFlags | 启动Activity的Flag
options |
ignoreTargetSecurity |
componentSpecified |
outActivity | 作为该函数的输出参数，记录启动的ActivityRecord
container |
inTask | 指定待启动Activity所在的任务。本例为null

如此多的函数入参，意味着该函数的执行场景非常多。从一个Activity启动另外一个Activity，总要考虑前一个Activity的状态，陷入复杂的数据传递过程，好在HomeActivity的启动过程场景相对简单，很多参数都置为null。

有了输入，我们再提前来看函数的返回值是些什么取值：

返回值 | 描述
--- | ---
START_SUCCESS(0) | 启动成功
START_INTENT_NOT_RESOLVED(-1) | 无法解析Intent所请求的Activity
START_CLASS_NOT_FOUND(-2) | 无法找到目标Activity的类
START_FORWARD_AND_REQUEST_CONFLICT(-3) | 带RequestCode启动Activity时，存在的一种与resultTo冲突的场景
START_PERMISSION_DENIED(-4) | 调用者没有获取启动Activity的授权
START_NOT_VOICE_COMPATIBLE(-7) | 当前并不支持语音
START_NOT_CURRENT_USER_ACTIVITY(-8) | 目标Activity并非对当前用户可见
START_SWITCHES_CANCELED(4) | App Switch功能关闭时，需要将待启动的Activity推入Pending状态

总结一下，小于零的返回值，表示启动失败；大于等于零的返回值，表示启动成功，通过一些大于零的整数来区分不同的启动场景。还有一些返回值没有在这里列出，因为还依赖于后续函数调用的返回值。

下面，我们就一层层深入函数，分析代码逻辑了。

{% highlight java %}
final int startActivityLocked(IApplicationThread caller,
    Intent intent, String resolvedType, ActivityInfo aInfo,
    IVoiceInteractionSession voiceSession, IVoiceInteractor voiceInteractor,
    IBinder resultTo, String resultWho, int requestCode,
    int callingPid, int callingUid, String callingPackage,
    int realCallingPid, int realCallingUid, int startFlags, Bundle options,
    boolean ignoreTargetSecurity, boolean componentSpecified, ActivityRecord[] outActivity,
    ActivityContainer container, TaskRecord inTask) {
    int err = ActivityManager.START_SUCCESS;
    ProcessRecord callerApp = null;
    if (caller != null) {
        ... // 本例中caller为null，省略该分支的代码
    }

    // 获取userId。在单用户的场景下，只有一个userId，就是0；
    // 在多用户的场景下，会根据uid的值计算出来userId。
    // uid与userId并不相同，uid是分配给应用程序的编号，userId代表多用户场景下的用户ID。
    final int userId = aInfo != null ? UserHandle.getUserId(aInfo.applicationInfo.uid) : 0;

    // sourceRecord和resultRecord都表示调用者，但两者有区别：
    // 在某些场景下sourceRecord与resultRecord并不相同，见下面的FLAG_ACTIVITY_FORWARD_RESULT
    ActivityRecord sourceRecord = null;
    ActivityRecord resultRecord = null;
    // 本例中，resultTo为null，所以，sourceRecord和resultRecord都还是null
    if (resultTo != null) {
        // 从已有的任务中，找到resultTo所标示的ActivityRecord
        sourceRecord = isInAnyStackLocked(resultTo);
        if (sourceRecord != null) {
            if (requestCode >= 0 && !sourceRecord.finishing) {
                resultRecord = sourceRecord;
            }
        }
    }

    // launchFlags就是Activity的启动参数，
    final int launchFlags = intent.getFlags();
    if ((launchFlags & Intent.FLAG_ACTIVITY_FORWARD_RESULT) != 0 && sourceRecord != null) {
        ... // 如果启动参数包含FLAG_ACTIVITY_FORWARD_RESULT，则需要对resultRecord进行调整
    }

    // 以下代码都是进行一些常规检查，如果不符合条件，则给定一个错误码，标记启动失败
    if (err == ActivityManager.START_SUCCESS && intent.getComponent() == null) {
        err = ActivityManager.START_INTENT_NOT_RESOLVED;
    }
    if (err == ActivityManager.START_SUCCESS && aInfo == null) {
        err = ActivityManager.START_CLASS_NOT_FOUND;
    }
    if (err == ActivityManager.START_SUCCESS
            && !isCurrentProfileLocked(userId)
            && (aInfo.flags & FLAG_SHOW_FOR_ALL_USERS) == 0) {
        err = ActivityManager.START_NOT_CURRENT_USER_ACTIVITY;
    }
    ... // 省略与语音相关的常规检查

    // 如果错误码被标记上，表示上面的常规检查没有通过，需要结束Activity的启动过程。
    final ActivityStack resultStack = resultRecord == null ? null : resultRecord.task.stack;
    if (err != ActivityManager.START_SUCCESS) {
        if (resultRecord != null) {
            // 此处，如果resultRecord不为null，则需要告诉调用者启动失败了
            resultStack.sendActivityResultLocked(-1,
            resultRecord, resultWho, requestCode,
            Activity.RESULT_CANCELED, null);
        }
        ActivityOptions.abort(options);
        return err;
    }

    // 常规检查通过，又要开始进行一系列的权限检查。上面是通过错误码err来标记了，
    // 权限检查是通过abort这个变量来标记的
    boolean abort = false;
    final int startAnyPerm = mService.checkPermission(
            START_ANY_ACTIVITY, callingPid, callingUid);
    ... // 省略大量权限检查的代码
    if (abort) {
        if (resultRecord != null) {
            resultStack.sendActivityResultLocked(-1, resultRecord, resultWho, requestCode, Activity.RESULT_CANCELED, null);
       }
       ActivityOptions.abort(options);
       // 如果权限检查失败，会中断Activity的启动过程，但返回的却是START_SUCCESS
       return ActivityManager.START_SUCCESS;
    }

    // 主角出场了，ActivityRecord在此创建。创建一个ActivityRecord要传入的参数基本都还是函数入参
    ActivityRecord r = new ActivityRecord(mService, callerApp, callingUid, callingPackage,
    intent, resolvedType, aInfo, mService.mConfiguration, resultRecord, resultWho,
    requestCode, componentSpecified, voiceSession != null, this, container, options);
    if (outActivity != null) {
        outActivity[0] = r;
    }

    // 对于HomeActivity的而言，appTimeTracker一直保持为null
    if (r.appTimeTracker == null && sourceRecord != null) {
        r.appTimeTracker = sourceRecord.appTimeTracker;
    }

    // mFocusedStack在之前将HomeTask挪到栈顶时，已经被置为HomeStack
    final ActivityStack stack = mFocusedStack;
    if (voiceSession == null && (stack.mResumedActivity == null
        || stack.mResumedActivity.info.applicationInfo.uid != callingUid)) {
        ... // AppSwitch相关的处理逻辑，暂不分析
    }
    if (mService.mDidAppSwitch) {
        mService.mAppSwitchesAllowedTime = 0;
    } else {
        mService.mDidAppSwitch = true;
    }

    // 先启动一些之前被阻塞的Activity，对于启动HomeActivity而言，显然之前没有被阻塞的Activity
    doPendingActivityLaunchesLocked(false);
    // 启动Activity过程的下一阶段
    err = startActivityUncheckedLocked(r, sourceRecord, voiceSession, voiceInteractor,
        startFlags, true, options, inTask);
    if (err < 0) {
        notifyActivityDrawnForKeyguard();
    }
    return err;
}
{% endhighlight %}

以上大片函数逻辑，关键节点在在于创建一个ActivityRecord：

- 在创建之前要进行参数设置(sourceRecord和resultRecord等)、常规检查(譬如调用者的包名是否存在）、权限检查；

- 在创建ActivityRecord之后，也有一些处理，包括AppSwitch，优先启动之前被阻塞的Activity，然后，进入了Activity过程的下一阶段: **startActivityUncheckedLocked()**，从函数命名可以看出，该做的检查已经做完了，剩下的函数调用就不需要进行额外的检查了(**Unchecked**)。

> 启动Activity过程的第一个大函数分析下来，想必读者内心是崩溃的，如此复杂的判定，竟然还只是创建了一个ActivityRecord！接下来的分析，只会更加崩溃，越往后的处理逻辑就越复杂。读者在后文中如果有阅读障碍，一定要再回过头来看前面的函数分析，多次重复阅读，知识是螺旋式积累的。

# 4. ASS.startActivityUncheckedLocked()

先描述一下几个新出来的函数入参：

函数入参 | 描述
--- | ---
r | 待启动的ActivityRecord，这是在上一个函数中刚刚新建的一个ActivityRecord对象。
sourceRecord | 调用者，即当前还处于显示状态的ActivityRecord。本例中由于是启动HomeActivity，所以该参数为null。
doResume | 表示是否要将Activity推入Resume状态，从上一个函数传入进来的参数值为true。其实，该参数为flase的情况我们也已经见过了：上个函数中，在调用ASS.startActivityUncheckedLocked()之前，会调用**doPendingActivityLaunchesLocked(false)**，表示要优先处理一些等待被启动的Activity，在函数内部也会调用startActivityUncheckedLocked()，给定doResume的值就是false。

上面的函数还有一些返回值没有列出，有一部分返回值是由该函数提供的：

返回值 | 描述
--- | ---
START_CLASS_NOT_FOUND(-2) | 无法找到目标Activity的类
START_SUCCESS(0) | 启动成功
START_RETURN_INTENT_TO_CALLER(1) | 当启动参数中带有START_FLAG_ONLY_IF_NEEDED标志时，如果目标Activity就是当前的调用者，则返回该值，启动结束
START_TASK_TO_FRONT(2) | 在已有任务中找到了目标Activity，则只需要把目标Activity挪到前台即可，启动结束
START_DELIVERED_TO_TOP(3) | 目标Activity位于任务栈顶，则只需要将Intent派送到栈顶的Activity即可，启动结束
START_RETURN_LOCK_TASK_MODE_VIOLATION(5) | 目标Activity的宿主任务处于LockTaskMode模式，且目标Activity的启动方式违背了LockTaskMode的规则，则不能启动目标Activity


该函数逻辑庞大，笔者将其分为3个代码片段。在分析过程中，笔者会适当的省略一些不影响主干逻辑的代码。

{% highlight java %}
// 片段1：Activity启动参数(launchMode, lauchFlags)的组合修正
final int startActivityUncheckedLocked(final ActivityRecord r, ActivityRecord sourceRecord,
       IVoiceInteractionSession voiceSession, IVoiceInteractor voiceInteractor, int startFlags,
       boolean doResume, Bundle options, TaskRecord inTask) {
    final Intent intent = r.intent;
    final int callingUid = r.launchedFromUid;

    if (inTask != null && !inTask.inRecents) {
        inTask = null;
    }

    // 获取Activity的启动模式，这些值是从<activity>标签中读取的，即目标Activity所定义的启动方式
    // 除了目标Activity定义的启动模式外，调用者也可以设置Activity的启动模式
    // 这些参数都体现在Intent的Flags中。
    final boolean launchSingleTop = r.launchMode == ActivityInfo.LAUNCH_SINGLE_TOP;
    final boolean launchSingleInstance = r.launchMode == ActivityInfo.LAUNCH_SINGLE_INSTANCE;
    final boolean launchSingleTask = r.launchMode == ActivityInfo.LAUNCH_SINGLE_TASK;

    // 处理启动参数FLAG_ACTIVITY_NEW_DOCUMENT。读者可以参阅SDK文档后来了解这个参数。
    int launchFlags = intent.getFlags();
    if ((launchFlags & Intent.FLAG_ACTIVITY_NEW_DOCUMENT) != 0 &&
            (launchSingleInstance || launchSingleTask)) {
        ...
    } else { ... }

    // 是否为后台启动任务的标志位
    final boolean launchTaskBehind = r.mLaunchTaskBehind
           && !launchSingleTask && !launchSingleInstance
           && (launchFlags & Intent.FLAG_ACTIVITY_NEW_DOCUMENT) != 0;

    if (r.resultTo != null && (launchFlags & Intent.FLAG_ACTIVITY_NEW_TASK) != 0
            && r.resultTo.task.stack != null) {
        // 如果Activity是在一个新的任务中启动，则resultTo是失效的
        r.resultTo.task.stack.sendActivityResultLocked(-1,
            r.resultTo, r.resultWho, r.requestCode,
            Activity.RESULT_CANCELED, null);
        r.resultTo = null;
    }

    // 如果启动参数包含FLAG_ACTIVITY_NEW_DOCUMENT，而且又没有resultTo，则意味着要在一个新的任务中启动Activity。
    // 后面还会出现这种类似的参数修正：在某些启动条件的组合下，就隐性要求在一个新的任务中启动Activity
    if ((launchFlags & Intent.FLAG_ACTIVITY_NEW_DOCUMENT) != 0 && r.resultTo == null) {
        launchFlags |= Intent.FLAG_ACTIVITY_NEW_TASK;
    }

    if ((launchFlags & Intent.FLAG_ACTIVITY_NEW_TASK) != 0) {
        if (launchTaskBehind
            || r.info.documentLaunchMode == ActivityInfo.DOCUMENT_LAUNCH_ALWAYS) {
        }
        // 对于后台启动的新任务，可以多任务运行
        launchFlags |= Intent.FLAG_ACTIVITY_MULTIPLE_TASK;
    }
    // Activity.onUserLeavingHint()是个回调函数，在onPause()之前会被调用，
    // 如果设置了FLAG_ACTIVITY_NO_USER_ACTION，则该回调函数不会被调用
    mUserLeaving = (launchFlags & Intent.FLAG_ACTIVITY_NO_USER_ACTION) == 0;

    if (!doResume) {
        r.delayedResume = true;
    }

    // FLAG_ACTIVITY_PREVIOUS_IS_TOP用于一些特殊的场景：待启动的Activity不会被作为栈顶，
    // 换句话说，调用者希望待启动的Activity马上销毁，就会使用该启动参数。
    // 通常情况下，notTop都为null。
    ActivityRecord notTop =
            (launchFlags & Intent.FLAG_ACTIVITY_PREVIOUS_IS_TOP) != 0 ? r : null;

    ... // 省略 START_FLAG_ONLY_IF_NEEDED的处理逻辑

    boolean addingToTask = false; // 表示是否在传入的inTask中启动Actiivty，后面会根据实际情况重新设置该变量
    TaskRecord reuseTask = null; // 表示复用的任务。如果inTask存在，则inTask就可以作为reuseTask。

    if (sourceRecord == null && inTask != null && inTask.stack != null) {
        ... // 这一段代码逻辑比较长，都是与inTask相关的处理。
        // 对于HomeActivity而言，传入的inTask为null，所以不会经过这段处理逻辑。
        // 需要说明的是：如果inTask不为空，则表示调用者希望目标Activity在指定的任务中运行
        // 这一段代码逻辑会根据inTask的实际情况完成一些设置，如果addingTask被设置为true，
        // 则表示目标Activity可以投放到inTask中
        reuseTask = inTask;
    } else {
        inTask = null;
    }

    // 根据调用者和目标Activity的启动模式，来调整目标Activity的启动参数。
    // 一些场景下，并没有设置目标Activity要在新的任务中启动，然而，实际情况又需要在新的任务中
    // 启动，譬如singleInstance就隐含了要新建一个任务的意思，这时候，就需要在启动参数中加上
    // FLAG_ACTIVITY_NEW_TASK。前面出现的调整FLAG_ACTIVITY_NEW_TASK读者们还记得吗？
    if (inTask == null) {
        if (sourceRecord == null) {
            if ((launchFlags & Intent.FLAG_ACTIVITY_NEW_TASK) == 0 && inTask == null) {
                // sourceRecord为null，表示调用者不是Activity，
                // 则强制在新的任务中启动Activity。
                launchFlags |= Intent.FLAG_ACTIVITY_NEW_TASK;
            }
        } else if (sourceRecord.launchMode == ActivityInfo.LAUNCH_SINGLE_INSTANCE) {
            // 如果调用者的启动模式为LAUNCH_SINGLE_INSTANCE，则需要在新的任务中启动新的Activity
            launchFlags |= Intent.FLAG_ACTIVITY_NEW_TASK;
        } else if (launchSingleInstance || launchSingleTask) {
            // 如果目标Activity的启动模式为singleInstance或SingleTask，则需要在新的任务中启动
            launchFlags |= Intent.FLAG_ACTIVITY_NEW_TASK;
        }
    }
// 未完接片段2
{% endhighlight %}

【代码片段1】主要是Activity各种启动参数的组合修正，读者最好借助于SDK文档理解这些参数的意义。
如果暂时不理解，也可以先忽略这些细节。对于HomeActivity的启动而言，不会涉及到上述的代码逻辑。

当启动参数修正后，就需要启动Activity了：

{% highlight java %}
// 片段2：处理目标Activity已经存在的情况
    ActivityInfo newTaskInfo = null;
    Intent newTaskIntent = null;
    ActivityStack sourceStack;
    if (sourceRecord != null) {
        if (sourceRecord.finishing) {
            // 如果调用者已经处于销毁状态，那意味着其所在的任务也可能被销毁了。
            // 待启动的Activity需要保留已有任务的信息，并强制在新的任务中启动
            if ((launchFlags & Intent.FLAG_ACTIVITY_NEW_TASK) == 0) {
                launchFlags |= Intent.FLAG_ACTIVITY_NEW_TASK;
                newTaskInfo = sourceRecord.info;
                newTaskIntent = sourceRecord.task.intent;
            }
            sourceRecord = null;
            sourceStack = null;
        } else {
            sourceStack = sourceRecord.task.stack;
        }
    } else {
        sourceStack = null;
    }

    boolean movedHome = false;
    ActivityStack targetStack; // 目标Activity的宿主栈，注意：宿主栈是ActivityStack，元素为TaskRecord的栈结构，而宿主任务是TaskRecord，元素为ActivityRecord的栈结构
    intent.setFlags(launchFlags); // 重新设置将修正后的launchFlags
    // 是否有动画是由启动参数FLAG_ACTIVITY_NO_ANIMATION决定的
    final boolean noAnimation = (launchFlags & Intent.FLAG_ACTIVITY_NO_ANIMATION) != 0;
    // 重头戏来了!
    if (((launchFlags & Intent.FLAG_ACTIVITY_NEW_TASK) != 0 &&
            (launchFlags & Intent.FLAG_ACTIVITY_MULTIPLE_TASK) == 0)
            || launchSingleInstance || launchSingleTask) {
        // 进入这个分支，意味着不是在当前任务中启动Activity，那就需要先找一下
        // 目标任务是否存在？
        if (inTask == null && r.resultTo == null) {
            // 找目标Activity有两个重要的函数，我们在后文会分析
            ActivityRecord intentActivity = !launchSingleInstance ?
                    findTaskLocked(r) : findActivityLocked(intent, r.info);
            // intentActivity如果不为空，则意味着找到了目标Activity，
            // 那么目标Activity所在的任务(TaskRecord)和任务所在的栈(ActivityRecord)就是宿主任务和宿主栈
            if (intentActivity != null) {
                if (isLockTaskModeViolation(intentActivity.task,
                        (launchFlags & (FLAG_ACTIVITY_NEW_TASK | FLAG_ACTIVITY_CLEAR_TASK))
                        == (FLAG_ACTIVITY_NEW_TASK | FLAG_ACTIVITY_CLEAR_TASK))) {
                    // LockTask相关的处理。LockTask是Android Lollipop引入了新功能，
                    // 具体介绍可以查阅：https://developer.android.com/work/cosu.html
                    showLockTaskToast();
                    return ActivityManager.START_RETURN_LOCK_TASK_MODE_VIOLATION;
                }

                if (r.task == null) {
                    r.task = intentActivity.task;
                }
                if (intentActivity.task.intent == null) {
                    intentActivity.task.setIntent(r);
                }
                // 设置目标栈targetStack
                targetStack = intentActivity.task.stack;
                targetStack.mLastPausedActivity = null;

                // 获取当前的焦点栈，这个栈是什么时候创建的呢?
                final ActivityStack focusStack = getFocusedStack();
                // 获取前可见的ActivityRecord，即curTop，这是在当前的焦点栈中找到的
                ActivityRecord curTop = (focusStack == null)
                        ? null : focusStack.topRunningNonDelayedActivityLocked(notTop);
                boolean movedToFront = false;
                if (curTop != null && (curTop.task != intentActivity.task ||
                        curTop.task != focusStack.topTask())) {
                    // 进入这个条件，意味着当前可见的Activity与待启动的Activity不在同一个任务
                    // 这种情况下，需要将宿主栈挪到前台。
                    r.intent.addFlags(Intent.FLAG_ACTIVITY_BROUGHT_TO_FRONT);
                    if (sourceRecord == null || (sourceStack.topActivity() != null &&
                            sourceStack.topActivity().task == sourceRecord.task)) {
                        if (launchTaskBehind && sourceRecord != null) {
                            intentActivity.setTaskToAffiliateWith(sourceRecord.task);
                        }
                        movedHome = true;
                        // 将目标Activity所在的任务挪到栈顶
                        targetStack.moveTaskToFrontLocked(intentActivity.task, noAnimation,
                                    options, r.appTimeTracker, "bringingFoundTaskToFront");
                        movedToFront = true;
                        if ((launchFlags &
                                (FLAG_ACTIVITY_NEW_TASK | FLAG_ACTIVITY_TASK_ON_HOME))
                                == (FLAG_ACTIVITY_NEW_TASK | FLAG_ACTIVITY_TASK_ON_HOME)) {
                            intentActivity.task.setTaskToReturnTo(HOME_ACTIVITY_TYPE);
                        }
                        options = null;
                    }
                }
                if (!movedToFront) {
                    targetStack.moveToFront("intentActivityFound");
                }
                if ((launchFlags&Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED) != 0) {...}
                if ((startFlags & ActivityManager.START_FLAG_ONLY_IF_NEEDED) != 0) {...}
                ... // 省略针对launchFlags的调整。
            } // END of "if (intentActivity != null)"
        } // END of "if (inTask == null && r.resultTo == null)"
    } // END of "if (((launchFlags & Intent.FLAG_ACTIVITY_NEW_TASK) != 0 ..."

    if (r.packageName != null) {
        // If the activity being launched is the same as the one currently
        // at the top, then we need to check if it should only be launched
        // once.
        ...
    } else {
        // 包名为null，则表示找不到待启动的Activity
        ...
        ActivityOptions.abort(options);
        return ActivityManager.START_CLASS_NOT_FOUND;
    }
// 未完接片段3
{% endhighlight %}

【代码片段2】主要处理在一个新的任务中启动Activity，而且目标Activity存在的情况，这意味着Activity之前已经启动过，只需要把其找出来，重新挪到前台显示即可。目标Activity所在的宿主栈之前可能在前台(Foreground)也可能在后台(Background)，如果在后台，则需要将宿主栈挪动前台。

对于HomeActivity的启动而言，显然不需要经过寻找和处理目标Activity的过程，因为开机时，HomeActivity之前还从未被启动过。

{% highlight java %}
// 片段3：处理目标Activity不存在的情况
    boolean newTask = false;
    boolean keepCurTransition = false;
    TaskRecord taskToAffiliate = launchTaskBehind && sourceRecord != null ?
        sourceRecord.task : null;
    if (r.resultTo == null && inTask == null && !addingToTask
            && (launchFlags & Intent.FLAG_ACTIVITY_NEW_TASK) != 0) {
        // 该类情况表示要在一个新的任务中启动Activity
        newTask = true;
        targetStack = computeStackFocus(r, newTask);
        targetStack.moveToFront("startingNewTask");

        if (reuseTask == null) {
            // 如果不存在一个可以复用的任务，则新建一个。
            r.setTask(targetStack.createTaskRecord(getNextTaskId(),
                    newTaskInfo != null ? newTaskInfo : r.info,
                    newTaskIntent != null ? newTaskIntent : intent,
                    voiceSession, voiceInteractor, !launchTaskBehind /* toTop */),
                    taskToAffiliate);
        } else {
            r.setTask(reuseTask, taskToAffiliate);
        }
        if (isLockTaskModeViolation(r.task)) {
            return ActivityManager.START_RETURN_LOCK_TASK_MODE_VIOLATION;
        }
        if (!movedHome) {
            if ((launchFlags &
                    (FLAG_ACTIVITY_NEW_TASK | FLAG_ACTIVITY_TASK_ON_HOME))
                    == (FLAG_ACTIVITY_NEW_TASK | FLAG_ACTIVITY_TASK_ON_HOME)) {
                r.task.setTaskToReturnTo(HOME_ACTIVITY_TYPE);
            }
        }
    } else if (sourceRecord != null) {
        // 该类情况下，宿主栈就是调用者Activity所在的ActivityStack。
        // 处理方式也大同小异，把宿主任务挪到栈顶，针对launchFlags做一些调整
        ...
    } else if (inTask != null) {
       // 在指定的任务栈中启动Activity
        ...
    } else {
        // 该类情况表示既不是从一个Activity启动，也不是在新的任务中启动，
        // 目前，代码漏记并不会走到该类场景
        ...
    }

    mService.grantUriPermissionFromIntentLocked(callingUid, r.packageName,
        intent, r.getUriPermissionsLocked(), r.userId);
    if (sourceRecord != null && sourceRecord.isRecentsActivity()) {
        r.task.setTaskToReturnTo(RECENTS_ACTIVITY_TYPE);
    }
    if (newTask) {
        EventLog.writeEvent(EventLogTags.AM_CREATE_TASK, r.userId, r.task.taskId);
    }
    ActivityStack.logStartActivity(EventLogTags.AM_CREATE_ACTIVITY, r, r.task);
    targetStack.mLastPausedActivity = null;
    // 启动一个新建的Activity
    targetStack.startActivityLocked(r, newTask, doResume, keepCurTransition, options);
    if (!launchTaskBehind) {
        mService.setFocusedActivityLocked(r, "startedActivity");
    }
    return ActivityManager.START_SUCCESS;
}
// 完
{% endhighlight %}

【代码片段3】主要处理目标Activity不存在的场景，即该Activity没有被启动过，或者启动过后已经销毁的场景。既然Activity没有被启动过，那就需要在宿主栈继续启动一个新的Activity，转入**ActivityStack.startActivityLocked()**进行处理。

> 启动Activity的第二个大函数**startstartActivityUncheckedLocked()**比前文分析的第一个大函数**startstartActivityLocked()**多了**Unchecked**关键字，意图很明显：在调用**Unchecked**这个函数的时候，不会再进行检查(常规包名检查、权限检查)，它关注的核心逻辑是为待启动的Activity找到宿主任务，Activity最终属于哪个任务中，有很多因素影响，譬如launchMode，launchFlags，当前任务的状态等，因此，要厘清楚该函数的各种分支判断，还需要结合实际Activity启动的动态场景，仅这么静态分析代码逻辑，是很难理解作者的编码意图的。建议读者设计一些Activity启动的场景，边断点调试，边理解代码逻辑。

**分析完了ASS.startActivityUncheckedLocked()的函数逻辑，我们一起来回顾一下是如何走到这一步的：**

<div align="center"><img src="/assets/images/activity/launchprocess/2-activity-launchprocess-part1.png" alt="Activity Launching Process"/></div>

- **1 AMS.startHomeActivityLocked()**：在系统进程执行systemReady()的最后，会调用该函数，这个函数的功能就是为了解析出HomeActivity的信息，为后面的启动工作做准备；在这之后，Activity启动的控制权交到ASS，它主要的职能是管理多个ActivityStack，所以扮演的是“承上启下”的角色，所谓“承上”，就是应对Activity启动的请求，完成一些Activity启动的检查、参数的设置以及栈调度的工作；所谓“启下”，就是指ASS只是为Activity启动准备必要的环境，譬如为目标Activity找到宿主任务。Activity启动时的调度还是交由后面接续完成。ActivityStackSupvisor作为ActivityStack的最高管理者，后面Activity的调度，还会求助于它；

- **2 startHomeActivity()**: 为了要显示Activity，就需要将其所在的ActivityStack挪到栈顶，即HomeStack的栈顶。需要注意的是，HomeStack早在系统进程启动时，就已经构建完毕，但HomeStack栈中还没有任何元素；

- **3 startActivityLocked()**: 启动Activity时，会有很多参数需要设置和调整，还会有一些常规检查，譬如调用者包名是否合法，一些基本的权限检查也是在这时候完成的。如果出现检查出错，则通过返回错误码中断启动过程。待启动的ActivityRecord就是在这一步被构建出来的；

- **4 startActivityUncheckedLocked()**: 检查完成之后，就要着手Activity的启动了，这时候需要对Activity的启动参数进行判定和调整，因为启动参数决定了目标Activity的存在于哪。如果能够在当前已有任务中找到目标Activity，那就看情况是否将其挪到前台，这时候就可以通过大于零的返回值完成启动过程了；如果当前未找到目标Activity，那就在宿主任务中启动一个新的Activity。

<b><font color="red">至此，HomeActivity启动的第二个大部分已经分析完毕，主要干了两件大事：其一是构建目标ActivityRecord，其二是寻找宿主TaskRecord。</font></b>

***

# 5. AS.startActivityLocked()

对于HomeActivity初次启动而言，之前没有Activity被创建，所以属于目标Activity还不存在的这一类场景，所以会进入该函数调用，意味着要在目标栈中启动一个新的Activity。

按照惯例，说明一下函数入参：

函数入参 | 描述
--- | ---
r | 待启动的ActivityRecord。
newTask | 是否需要在新的任务中启动Activity。对于初次启动HomeActivity而言，该值为true。
doResume | 是否需要立即显示Activity。有些需要Pending的Activity，该值为false；对于初次启动HomeActivity而言，该值为true。
keeyCurTransition | 与Activity启动动画相关的参数，由上面的函数计算得到。

该函数返回void，代码逻辑如下：

{% highlight java %}
final void startActivityLocked(ActivityRecord r, boolean newTask,
        boolean doResume, boolean keepCurTransition, Bundle options) {
    TaskRecord rTask = r.task;
    final int taskId = rTask.taskId;
    if (!r.mLaunchTaskBehind && (taskForIdLocked(taskId) == null || newTask)) {
        // 进入该条件，表示宿主栈ActivityStack中没有历史任务，或者强制要求在新的任务中启动Activity
        // 既然是一个新任务，那么就需要需要将任务插入宿主栈顶
        insertTaskAtTop(rTask, r);
        // 此处调用的WindowManagerService的接口，留到后文分析
        mWindowManager.moveTaskToTop(taskId);
    }
    TaskRecord task = null;
    if (!newTask) {
        // 进入该条件，表示需要在一个已有的任务中启动Activity
        // 先设置一个标志位，表示是否需要启动Activity，默认当然是要显示；
        // 但是当目标任务之上有全屏的Activity时，该标志位被置为false。
        boolean startIt = true;
        for (int taskNdx = mTaskHistory.size() - 1; taskNdx >= 0; --taskNdx) {
            // 从上往下遍历宿主栈中的所有任务，找到目标任务的位置
            task = mTaskHistory.get(taskNdx);
            if (task.getTopActivity() == null) {
                continue;
            }
            if (task == r.task) {
                if (!startIt) {
                    ...
                    task.addActivityToTop(r);
                    r.putInHistory();
                    mWindowManager.addAppToken(task.mActivities.indexOf(r), r.appToken,
                            r.task.taskId, mStackId, r.info.screenOrientation, r.fullscreen,
                            (r.info.flags & ActivityInfo.FLAG_SHOW_FOR_ALL_USERS) != 0,
                            r.userId, r.info.configChanges, task.voiceSession != null,
                            r.mLaunchTaskBehind);
                    ActivityOptions.abort(options);
                    return;
                }
                break;
            } else if (task.numFullscreen > 0) {
                // 如果目标任务之上的某个任务包含全屏显示的Activity，则不需要显示目标Activity
                startIt = false;
            }
        }
    }

    // 以上完成的操作就是将待显示的任务放到了宿主栈的栈顶位置，
    // 接下来，需要将待显示的ActivityRecord放到任务的栈顶

    task = r.task;
    task.addActivityToTop(r);
    task.setFrontOfTask(); // 将一个新的ActivityRecord添加到任务栈顶后，需要重新调整FrontOfTask

    r.putInHistory(); // 标记ActivityRecord已经放置到宿主栈中

    if (!isHomeStack() || numActivities() > 0) {
        // 进入该分支，表示宿主栈中已经有Activity
        ... // 此处省略与Activity启动动画相关的代码
        // 将待启动的Activity绑定到窗口上
        mWindowManager.addAppToken(task.mActivities.indexOf(r),
                r.appToken, r.task.taskId, mStackId, r.info.screenOrientation, r.fullscreen,
                (r.info.flags & ActivityInfo.FLAG_SHOW_FOR_ALL_USERS) != 0, r.userId,
                r.info.configChanges, task.voiceSession != null, r.mLaunchTaskBehind);
        ... // 此处省略与Activity启动动画相关的代码
    } else {
        // 进入该分支，表示当前的宿主栈中还没有任何Activity，则不需要设置任何Activity启动相关的动画
        // 只是将待启动的Activity绑定到窗口上
        mWindowManager.addAppToken(task.mActivities.indexOf(r), r.appToken,
                r.task.taskId, mStackId, r.info.screenOrientation, r.fullscreen,
                (r.info.flags & ActivityInfo.FLAG_SHOW_FOR_ALL_USERS) != 0, r.userId,
                r.info.configChanges, task.voiceSession != null, r.mLaunchTaskBehind);
        ActivityOptions.abort(options);
        options = null;
    }

    // 将Activity推入显示状态
    if (doResume) {
        mStackSupervisor.resumeTopActivitiesLocked(this, r, options);
    }
}
{% endhighlight %}

该函数会经过以下3大块逻辑：

- 将ActivityRecord放到宿主任务的栈顶位置。注意，这里有两个栈顶位置：一个是ActivityRecord在TaskRecord中的位置，另一个是TaskRecord在ActivityStack中的位置。前一个是该函数保证的，但后一个，还得根据实际的情况决定。如果是在一个新的任务中启动Activity，即newTask为true，那么，这个新的TaskRecord就会插入ActivityStack的栈顶，初次启动HomeActivity属于此类情况；

- 将待启动的ActivityRecord绑定到了一个窗口。与此同时，Activity启动的动画也在此设置。注意，本函数的分析中，省略了部分与WMS交互的窗口操作逻辑；

- 判断doResume的值，决定是否要将ActivityRecord迁移到显示状态(Resumed)。这个功能是交由resumeTopActivitiesLocked()实现的。

# 6. ASS.resumeTopActivitiesLocked()

初次看到这个函数名，读者心中可能会有疑问？默认都是显示一个Activity，该函数名中为什么会有Activities这种复数出现呢？难道有很多Activity都要被显示吗？

在[Android四大组件之Activity--管理方式](2016-02-01-Activity-Maintenance.md)一文中我们指出，ASS的职能就是管理多个ActivityStack，然而，为什么会有多个ActivityStack的这种设计呢？其实，在低版本的Android中，只有一个ActivityStack，它对应到手机屏幕；到了高版本的Android，支持多屏显示了，譬如可以同时在手机和电视上显示不同的Activity。这时候就有了多个ActivityStack的概念，于是乎，多个ActivityStack的管理者ASS就应运而生了。
ASS中还有很多其他类似的函数，实现逻辑都比较简单，仅仅是完成一些多ActivityStack的管理功能，真正的复杂的调度逻辑还是在ActivityStack中

该函数的代码实现如下：

{% highlight java %}
boolean resumeTopActivitiesLocked(ActivityStack targetStack, ActivityRecord target,
        Bundle targetOptions) {
    if (targetStack == null) {
        targetStack = mFocusedStack;
    }
    boolean result = false;
    if (isFrontStack(targetStack)) {
        // 转交ActivityStack完成待启动Activity的显示
        result = targetStack.resumeTopActivityLocked(target, targetOptions);
    }
    // 对所有显示设备上的ActivityStack都进行相同的操作
    for (int displayNdx = mActivityDisplays.size() - 1; displayNdx >= 0; --displayNdx) {
        final ArrayList<ActivityStack> stacks = mActivityDisplays.valueAt(displayNdx).mStacks;
        for (int stackNdx = stacks.size() - 1; stackNdx >= 0; --stackNdx) {
            final ActivityStack stack = stacks.get(stackNdx);
            if (stack == targetStack) {
                // 上面的逻辑中，已经处理过了
                continue;
            }
            // 转由其他显示设备的ActivityStack完成待启动Activity的显示
            if (isFrontStack(stack)) {
                stack.resumeTopActivityLocked(null);
            }
        }
    }
    return result;
}
{% endhighlight %}

该函数的逻辑可以一句话说明白，就是将所有ActivityStack栈顶的ActivityRecord迁移到显示状态，都是通过调用AS.resumeTopActivityLocked()来完成实际的操作，细细品味，调用参数的传入略有区别：

- 宿主ActivityStack，传入的参数是待启动的ActivityRecord；
- 其他ActivityStack，传入的参数的是null

在接下来的分析中，我们会解释这种区别的含义是什么。

# 7. AS.resumeTopActivityInnerLocked()

上一个函数中，调用的是AS.resumeTopActivityLocked()，其职能很简单，就是为了避免递归调用，本文省略之，直接进入AS.resumeTopActivityInnerLocked()进行分析。

函数入参 | 描述
--- | ---
prev | 当前正在显示的ActivityRecord
options |

该函数返回true表示XXXX；返回false表示并没有将待显示的ActivityRecord推进到Resumed状态。

不知各位读者有没有发现，在上一个函数发起调用时，传入的参数名称是**target**，表示待启动的ActivityRecord；但这里摇身一变，参数名称却是**prev**，表示之前启动的ActivityRecord，即将要进入Pausing状态的那个Activity，到底意欲几何？

问题接踵而来，只有回到代码中，才能找到问题的答案：

{% highlight java %}
// 代码片段1
private boolean resumeTopActivityInnerLocked(ActivityRecord prev, Bundle options) {
    if (!mService.mBooting && !mService.mBooted) {
        // 如果系统还未启动完毕，那AMS还不能正常工作，所以也不能显示Activity
        return false;
    }

    ... // 省略parentActivity的相关判定
    ActivityRecord parent = mActivityContainer.mParentActivity;

	// 当前AS中可能存在一些正处于Intializing状态的ActivityRecord，
    // 如果这些ActivityRecord不是位于栈顶，而且正在执行窗口启动动画，
    // 那么，就需要取消这些Activity的启动动画。
    cancelInitializingActivities();

    // 找到当前AS的栈顶
    final ActivityRecord next = topRunningActivityLocked(null);
    final boolean userLeaving = mStackSupervisor.mUserLeaving;
    mStackSupervisor.mUserLeaving = false;
    final TaskRecord prevTask = prev != null ? prev.task : null;
    if (next == null) {
        // 进入该条件分支表示AS中没有要显示的Activity
        final String reason = "noMoreActivities";
        if (!mFullscreen) {
            // 当前AS不是全屏显示，则需要将焦点切换到下一个待显示的AS
            final ActivityStack stack = getNextVisibleStackLocked();
            if (adjustFocusToNextVisibleStackLocked(stack, reason)) {
                return mStackSupervisor.resumeTopActivitiesLocked(stack, prev, null);
            }
        }
        // 默认情况下，AS都是占据全屏的，所以，当前AS如果没有要显示的Activity，则会要求显示桌面
        ActivityOptions.abort(options);
        final int returnTaskType = prevTask == null || !prevTask.isOverHomeStack() ?
                    HOME_ACTIVITY_TYPE : prevTask.getTaskToReturnTo();
        return isOnHomeDisplay() &&
            mStackSupervisor.resumeHomeStackTask(returnTaskType, prev, reason);
    }

    next.delayedResume = false;
    if (mResumedActivity == next && next.state == ActivityState.RESUMED &&
            mStackSupervisor.allResumedActivitiesComplete()) {
        // 当前正在显示的Activity正好就是下一个待显示的Activity，
        // 那么，就中断对待显示ActivityRecord的调度
        mWindowManager.executeAppTransition();
        mNoAnimActivities.clear();
        ActivityOptions.abort(options);
        return false;
    }

    final TaskRecord nextTask = next.task;
    if (prevTask != null && prevTask.stack == this &&
        prevTask.isOverHomeStack() && prev.finishing && prev.frontOfTask) {
        ...
    }

    if (mService.isSleepingOrShuttingDown()
        && mLastPausedActivity == next
        && mStackSupervisor.allPausedActivitiesComplete()) {
        // 系统进入休眠状态，当前AS的栈顶Activity已经处于Paused状态
        // 那么，中断对待显示Activity的调度
        mWindowManager.executeAppTransition();
        mNoAnimActivities.clear();
        ActivityOptions.abort(options);
        return false;
    }

    if (mService.mStartedUsers.get(next.userId) == null) {
        // 如果找不到启动Activity的User，则返回
        return false;
    }

	// 在ASS中维护了很多数组，来统一管理ActivityRecord的状态，
    // 譬如mStoppingActivities记录了当前所有处于Stopping状态的ActivityRecord。
    // 在某些场景下，待显示ActivityRecord可能处于这些数组中，但需要从中剔除
    mStackSupervisor.mStoppingActivities.remove(next);
    mStackSupervisor.mGoingToSleepActivities.remove(next);
    next.sleeping = false;
    mStackSupervisor.mWaitingVisibleActivities.remove(next);

	// 如果当前还有ActivityRecord不是处于PAUSED, STOPPED或STOPPING这三个状态之一，
    // 那么，需要先等这些ActivityRecord进入停止状态
	if (!mStackSupervisor.allPausedActivitiesComplete()) {
        return false;
    }
// 未完接代码片段2
{% endhighlight %}

【代码片段1】主要是一些“路障”，即便将待显示ActivityRecord已经位于栈顶，但要真正将其显示出来，即迁移到Resumed状态，这一路有很多障碍，或者说还有很多前提条件需要满足，譬如，系统要休眠时，当前启动过程要中断；当前有Activity正处于Pausing状态时，也需要等其执行完毕。

{% highlight java %}
// 代码片段2
    // LauncherSource表示当前是哪个用户在启动Activity
    // 实则是获取一个WakeLock，保证在显示Activity的过程中，系统不会进行休眠状态
    mStackSupervisor.setLaunchSource(next.info.applicationInfo.uid);

	// Activity的启动参数中包含FLAG_RESUME_WHILE_PAUSING
    // 表示可以在当前显示的Activity执行Pausing时，同时进行Resume操作
    // 变量dontWaitForPause的取意就是不需要等到Activity执行Pause完毕
	boolean dontWaitForPause = (next.info.flags&ActivityInfo.FLAG_RESUME_WHILE_PAUSING) != 0;
    // 将后台AS中的Activity迁移到Pausing状态
    boolean pausing = mStackSupervisor.pauseBackStacks(userLeaving, true, dontWaitForPause);
    // 将当前AS中正在显示的Activity迁移到Pausing状态
    if (mResumedActivity != null) {
        pausing |= startPausingLocked(userLeaving, false, true, dontWaitForPause);
    }
    if (pausing) {
        // 当前有正在Pausing的Activity
        if (next.app != null && next.app.thread != null) {
            mService.updateLruProcessLocked(next.app, true, null);
        }
        return true;
    }

    try {
        // 通过PackageManager修改待启动Package的状态
        AppGlobals.getPackageManager().setPackageStoppedState(
                   next.packageName, false, next.userId);
    } catch {...}

    boolean anim = true;
    ... // 省略与Activity切换动画相关的代码
    ActivityStack lastStack = mStackSupervisor.getLastStack();
    if (next.app != null && next.app.thread != null) {
        // 待启动Activity的宿主进程已经存在了
        mWindowManager.setAppVisibility(next.appToken, true);
        next.startLaunchTickingLocked();
        ActivityRecord lastResumedActivity =
                lastStack == null ? null :lastStack.mResumedActivity;
        ActivityState lastState = next.state;
        mService.updateCpuStats();

        // **这里，将待显示的Activity已经处于Resumed状态**
        next.state = ActivityState.RESUMED;
        mResumedActivity = next;
        next.task.touchActiveTime();
        mRecentTasks.addLocked(next.task);
        mService.updateLruProcessLocked(next.app, true, null);
        updateLRUListLocked(next);
        mService.updateOomAdjLocked();
    } else {
       ...
       mStackSupervisor.startSpecificActivityLocked(next, true, true);
    }
    return true;
}
{% endhighlight %}

【代码片段2】 首先要将当前正在显示的Activity迁移到Pausing状态，然后要将待显示的Activity迁移到Resumed状态，然而，这时候待显示Activity的宿主进程可能还未启动，这就需要调用**ASS.startSpecificActivityLocked()**。

<b><font color="red">至此，HomeActivity启动的第三大部分分析完毕，完成两件大事：其一是将ActivityRecord挪到栈顶位置；其二是尝试将栈顶的ActivityRecord迁移到显示状态(Resumed)</font></b>

***

# 8. ASS.startSpecificActivityLocked()

第一次启动HomeActivity时，由于桌面进程还未启动，所以便进入了该函数。
多了一个**Specific**关键字，表明Activity的启动操作到这一步已经明确下来，XXX

{% highlight java %}
void startSpecificActivityLocked(ActivityRecord r,
        boolean andResume, boolean checkConfig) {
    ProcessRecord app = mService.getProcessRecordLocked(r.processName,
            r.info.applicationInfo.uid, true);
    r.task.stack.setLaunchTime(r);
    if (app != null && app.thread != null) {
        try {
            if ((r.info.flags&ActivityInfo.FLAG_MULTIPROCESS) == 0
                    || !"android".equals(r.info.packageName)) {
                app.addPackage(r.info.packageName, r.info.applicationInfo.versionCode, mService.mProcessStats);
            }

            realStartActivityLocked(r, app, andResume, checkConfig);
            return;
        } catch (RemoteException e) { ... }
    }

    // 启动一个新的应用进程
    mService.startProcessLocked(r.processName, r.info.applicationInfo, true, 0,
                "activity", r.intent.getComponent(), false, false, true);
}
{% endhighlight %}


# 9. AMS.startProcessLocked(String processName...)

在AMS中有多个重载的**startProcessLocked()**函数，我们先来看其中一个，根据processName来启动进程，这时候可能processName对应的进程还没创建。

{% highlight java %}
final ProcessRecord startProcessLocked(String processName, ApplicationInfo info,
        boolean knownToBeDead, int intentFlags, String hostingType, ComponentName hostingName,
        boolean allowWhileBooting, boolean isolated, int isolatedUid, boolean keepIfLarge,
        String abiOverride, String entryPoint, String[] entryPointArgs, Runnable crashHandler) {
    long startTime = SystemClock.elapsedRealtime();
    ProcessRecord app;
    if (!isolated) {
        FLAG_FROM_BACKGROUND
        app = getProcessRecordLocked(processName, info.uid, keepIfLarge);
        checkTime(startTime, "startProcess: after getProcessRecord");
		// 启动参数中，带有FLAG_FROM_BACKGROUND标志，表示进程需要后台启动
        if ((intentFlags & Intent.FLAG_FROM_BACKGROUND) != 0) {
            if (mBadProcesses.get(info.processName, info.uid) != null) {
                // 后台启动一个BadProcess，直接退出
                return null;
            }
        } else {
            // 前台启动，则需要将宿主进程从坏的进程中剔除
            mProcessCrashTimes.remove(info.processName, info.uid);
            if (mBadProcesses.get(info.processName, info.uid) != null) {
                mBadProcesses.remove(info.processName, info.uid);
                if (app != null) {
                    app.bad = false;
                }
            }
        }
    } else {
       app = null;
    }

    // 当进程已经被分配了PID时
    if (app != null && app.pid > 0) {
        if (!knownToBeDead || app.thread == null) {
            // 进程还处于启动的过程中
            app.addPackage(info.packageName, info.versionCode, mProcessStats);
            checkTime(startTime, "startProcess: done, added package to proc");
            return app;
        }

        // 进程已经挂掉
        killProcessGroup(app.info.uid, app.pid);
        handleAppDiedLocked(app, true, true);
    }

    String hostingNameStr = hostingName != null
            ? hostingName.flattenToShortString() : null;
     // 创建一个新的ProcessRecord
    if (app == null) {
        app = newProcessRecordLocked(info, processName, isolated, isolatedUid);
        ...
    }

    // 如果系统还未启动，则需要将待启动进程先保持住，等系统启动后，再来启动这些进程
    if (!mProcessesReady
            && !isAllowedWhileBooting(info)
            && !allowWhileBooting) {
        if (!mProcessesOnHold.contains(app)) {
            mProcessesOnHold.add(app);
        }
        return app;
    }

    // 调用另外一个startProcessLocked()函数
    startProcessLocked(
           app, hostingType, hostingNameStr, abiOverride, entryPoint, entryPointArgs);
    return (app.pid != 0) ? app : null;
}
{% endhighlight %}

该函数的逻辑有两个关键点：

- 对于启动后台进程的处理。进程有isolated的概念，意味着这是一个隔离的进程。对于隔离的进程而言，每次启动都是独立的，不能复用已有的进程信息。如果要启动一个非隔离的进程，那么就需要区分进程是在前台启动还是后台启动，这是用户体验相关的设计。

  在AMS中维护了一个badProcesses的结构体，用于保存一些“坏进程”，什么才是“坏进程”呢？如果一个进程在一分钟内连续崩溃两次，那就变成了一个“坏进程”。对于后台启动的进程而言(即启动参数中带有FLAG_FROM_BACKGROUND标识)，如果进程崩溃了，会造成用户使用的困惑，因为进程崩溃时，会弹出一个对话框，而后台启动的进程是没有任何操作界面的，这时候弹一个框，用户会觉得自己什么都没干，却弹出了一个对话框。所以，后台启动一个“坏进程”时，会直接退出。

  当进程是在前台启动时，即便是一个“坏进程”，那也应该宽恕这个进程以前的不良记录，因为这通常是用户通过界面主动要唤起的进程。本着用户是上帝的原则，还是得让用户达到启动进程的目的，即便这个进程可能再次崩溃。

- 创建一个新的ProcessRecord。当进程还未启动时，变量app为null，这时候会调用AMS.newProcessRecord来创建一个新的ProcessRecord，然后再调用另外一个重载的AMS.startProcessLocked()函数，来创建一个进程。

# 10. AMS.newProcessRecordLocked()

对于第一次启动HomeActivity而言，Home进程还不存在，所以会顺利进入到这个函数中。

{% highlight java %}
final ProcessRecord newProcessRecordLocked(ApplicationInfo info, String customProcess,
        boolean isolated, int isolatedUid) {
    String proc = customProcess != null ? customProcess : info.processName;
    // 电量统计
    BatteryStatsImpl stats = mBatteryStatsService.getActiveStatistics();
    int uid = info.uid;
    ... // 省略与isolated相关调整uid的代码
    final ProcessRecord r = new ProcessRecord(stats, info, proc, uid);
    if (!mBooted && !mBooting
            && userId == UserHandle.USER_OWNER
            && (info.flags & PERSISTENT_MASK) == PERSISTENT_MASK) {
        r.persistent = true;
    }
    addProcessNameLocked(r);
    return r;
}
{% endhighlight %}

函数逻辑简单明了，根据ApplicaitonInfo创建一个ProcessRecord，并将ProcessRecord加入AMS的管理范围，与此同时，与进程相关的电量统计也是在这一步被绑定上的。

# 11. AMS.startProcessLocked(ProcessRecord app...)

进入该函数，意味着进程的ProcessRecord已经构建好了，但进程真正的运行环境还没有准备好啊，所以该函数的职能就是为了构建应用程序真正的进程环境。

{% highlight java %}
private final void startProcessLocked(ProcessRecord app, String hostingType,
        String hostingNameStr, String abiOverride, String entryPoint, String[] entryPointArgs) {

    if (app.pid > 0 && app.pid != MY_PID) {
        // 新启动进程了，清除超时消息设置
        synchronized (mPidsSelfLocked) {
            mPidsSelfLocked.remove(app.pid);
            mHandler.removeMessages(PROC_START_TIMEOUT_MSG, app);
        }
        app.setPid(0);
    }
    // 在HoldProcess中清除app
    mProcessesOnHold.remove(app);
    updateCpuStats();

    ... // 省略gid相关的设置，gid与进程的访问权限相关
    ... // 省略debugFlags相关的处理，与进程的调试选项相关

    // 创建一个进程
    Process.ProcessStartResult startResult = Process.start(entryPoint,
            app.processName, uid, uid, gids, debugFlags, mountExternal,
            app.info.targetSdkVersion, app.info.seinfo, requiredAbi, instructionSet,
            app.info.dataDir, entryPointArgs);
    ...
}
{% endhighlight %}

略去了一大堆进程启动参数设置相关的代码后，终于可以创建一个进程了，**Process.start()**的具体实现我们不在此处展开，各位读者可以参考源码。我们知道应用进程都是从Zygote进程fork出来的，这正是**Process.start()**函数的职能，它会给二进制程序**zygote**准备一些参数，然后通过系统调用fork()出一个子进程，这就是要启动的应用进程。

**分析完AMS.startProcessLocked(ProcessRecord app...)函数，我们来总结一下是如何走到这一步的：**

<div align="center"><img src="/assets/images/activity/launchprocess/2-activity-launchprocess-part2.png" alt="Activity Launching Process"/></div>

HomeActivity经过了前面4个函数，得到了结论是：HomeActivity是一个新启动的Activity，当前栈中并不存在。接下来的逻辑，就是试图要显示HomeActivity：

- **5 AS.startActivityLocked()**：将待显示的Activity挪到到栈顶位置，意味着待显示的ActivityRecord是TaskRecord的栈顶，并且TaskRecord是当前ActivityStack的栈顶。这里还会设置Activity的启动动画

- **6 ASS.resumeTopActivitiesLocked()**：ActivityRecord已经在栈顶后，就需要将其迁移到显示状态(Resumed)，由于Android支持多屏幕，所有需要对多个AS的栈顶都进行这个操作，ASS作为多个AS的管理者，很自然的就承担的这个工作。

- **7 AS.resumeTopActivityInnerLocked()**：收到上级的指示后，AS开始将栈顶的ActivityRecord推进到显示状态。首先，需要将当前正在显示的Activity推进到Pausing状态。对于HomeActivity而言，它就是第一个要启动的Activity，所以当前并没有正在显示的。

- **8 ASS.startSpecificActivityLocked()**：启动Activity带上Specific关键字，表示已经所有的障碍已经排除，明确(Specific)要启动目标Activity了。然而，这时候可能宿主进程还没创建呢，HomeActivity就属于这种情况。

- **9 AMS.startProcessLocked(String processName...)**：该函数的主要目的是为了准备一个ProcessRecord对象，如果AMS中还没有待启动Activity所在宿主进程的ProcessRecord对象，则需要新建一个。此外，对于后台启动的进程，有一个BadProcesses相关的处理逻辑。

- **10 AMS.newProcessRecordLocked()**：新建一个ProcessRecord对象。在[Android四大组件之Activity--管理方式](2016-02-01-Activity-Maintenance.md)一文中，介绍了ProcessRecord这个数据结构，它是用来维护进程的运行时的状态信息。AMS统一管理所有应用进程和系统进程的ProcessRecord。

- **11 AMS.startProcessLocked(ProcessRecord app...)**：目的是为了启动ProcessRecord所关联的进程，在准备进程启动的参数之后，就会通过Zygote孵化出一个子进程，这就是Activity的宿主应用进程。

<b><font color="red">至此，HomeActivity启动的第四大部分分析完毕，干了一件大事：创建待启动Activity的宿主应用进程。</font></b>

> 在介绍完HomeActivity启动路径上的11个函数之后，终于把一个应用进程给启动了。想必读者内心一定是百感交集，坦白说，从代码设计的角度，这些函数无论从实现上还是命名上，笔者觉得并不优美，太多的分支条件交织在一起，往往一个函数看下来就已经摸不着头脑了。在理解这一部分代码时，一定要把握好整体与局部的关系：整体路径是Activity启动过程，而局部有很多条件约束，一些约束条件是由Activity的管理方式导致的，一些约束条件是实际的用户场景和需求导致的，读者不要陷入这些局部中，一定要在脑海中保持一条清晰的Activity启动路径。
>
> 稍微舒缓一下，再给大家带来一个噩耗，创建一个应用进程，还仅仅只是Activity启动的半途，后面的路还长着了。以上的过程，基本都在系统进程中完成，接下来的过程需要系统进程和应用进程不断进行通信，才能把Activity给真正启动起来，在[Activity的启动过程(下)](2016-10-23-Activity-LaunchProcess-Part2.md)一文中，我们再见。

***

# 总结

本文分成四个大的部分介绍Activity的启动过程：

1. 构建个HomeIntent，并将HomeTask挪到HomeStack的栈顶；涉及到**AMS.startHomeActivityLocked()、ASS.startHomeActivity、 ASS.moveHomeStackTaskToTop()、AS.moveHomeStackTaskToTop()**这几个函数；关键点在于HomeTask的挪动过程。

2. 构建ActivityRecord，并未其寻找宿主任务TaskRecord。涉及**ASS.startActivityLocked()、ASS.startActivityUncheckedLocked()**两个大函数；关键点在于ActivityRecord创建前的检查，以及创建后，根据启动参数寻找宿主任务的过程。

3. 挪动ActivityRecord到宿主栈顶。涉及**AS.startActivityLocked()、ASS.resumeTopActivitiesLocked()、AS.resumeTopActivityInnerLocked()**这几个函数；当ActivityRecord位于栈顶时，会尝试将其迁移到显示状态。

4. 创建ActivityRecord所在的应用进程。涉及**ASS.startSpecificActivityLocked()、AMS.startProcessLocked()、AMS.newProcessRecordLocked()**这几个函数。对于HomeActivity第一次启动而言，宿主进程还未创建，所以需要先创建一个可以执行的进程环境。
