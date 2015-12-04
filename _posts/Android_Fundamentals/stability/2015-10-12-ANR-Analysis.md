---
layout: post
category: Android系统原理
title: ANR机制以及问题分析
tagline:
tags:  [Android调试]
---
{% include JB/setup %}

# 1. 概览

`ANR(Application Not Responding)`，应用程序无响应，简单一个定义，却涵盖了很多Android系统的设计思想。

首先，ANR属于应用程序的范畴，这不同于SNR(System Not Respoding)，SNR反映的问题是系统进程(system_server)失去了响应能力，而ANR明确将问题圈定在应用程序。
SNR由Watchdog机制保证，具体可以查阅[Watchdog机制以及问题分析](http://duanqz.github.io/android%E7%B3%BB%E7%BB%9F%E5%8E%9F%E7%90%86/2015/10/12/Watchdog-Analysis/);
ANR由消息处理机制保证，Android在系统层实现了一套精密的机制来发现ANR，核心原理是消息调度和超时处理。

其次，ANR机制主体实现在系统层。所有与ANR相关的消息，都会经过系统进程(system_server)调度，然后派发到应用进程完成对消息的实际处理，同时，系统进程设计了不同的超时限制来跟踪消息的处理。
一旦应用程序处理消息不当，超时限制就起作用了，它收集一些系统状态，譬如CPU/IO使用情况、进程函数调用栈，并且报告用户有进程无响应了(ANR对话框)。

然后，ANR问题本质是一个性能问题。ANR机制实际上对应用程序主线程的限制，要求主线程在限定的时间内处理完一些最常见的操作(启动服务、处理广播、处理输入)，
如果处理超时，则认为主线程已经失去了响应其他操作的能力。主线程中的耗时操作，譬如密集CPU运算、大量IO、复杂界面布局等，都会降低应用程序的响应能力。

最后，部分ANR问题是很难分析的，有时候由于系统底层的一些影响，导致消息调度失败，出现问题的场景又难以复现。
这类ANR问题往往需要花费大量的时间去了解系统的一些行为，超出了ANR机制本身的范畴。

# 2. ANR机制

分析一些初级的ANR问题，只需要简单理解最终输出的日志即可，但对于一些由系统问题(譬如CPU负载过高、进程卡死)引发的ANR，就需要对整个ANR机制有所了解，才能定位出问题的原因。

ANR机制可以分为两部分：

- **ANR的监测**。Android对于不同的ANR类型(Broadcast, Service, InputEvent)都有一套监测机制。

- **ANR的报告**。在监测到ANR以后，需要显示ANR对话框、输出日志(发生ANR时的进程函数调用栈、CPU使用情况等)。

整个ANR机制的代码也是横跨了Android的几个层：

- **App层**：应用主线程的处理逻辑

- **Framework层**： ANR机制的核心

  - [frameworks/base/services/core/java/com/android/server/am/ActivityManagerService.java](https://android.googlesource.com/platform/frameworks/base/+/master/services/core/java/com/android/server/am/ActivityManagerService.java)
  - [frameworks/base/services/core/java/com/android/server/am/BroadcastQueue.java](https://android.googlesource.com/platform/frameworks/base/+/master/services/core/java/com/android/server/am/BroadcastQueue.java)
  - [frameworks/base/services/core/java/com/android/server/am/ActiveServices.java](https://android.googlesource.com/platform/frameworks/base/+/master/services/core/java/com/android/server/am/ActiveServices.java)
  - [frameworks/base/services/core/java/com/android/server/input/InputManagerService.java](https://android.googlesource.com/platform/frameworks/base/+/master/services/core/java/com/android/server/input/InputManagerService.java)
  - [frameworks/base/services/core/java/com/android/server/wm/InputMonitor.java](https://android.googlesource.com/platform/frameworks/base/+/master/services/core/java/com/android/server/wm/InputMonitor.java)
  - [frameworks/base/core/java/android/view/InputChannel](https://android.googlesource.com/platform/frameworks/base/+/master/core/java/android/view/InputChannel.java)
  - [frameworks/base/services/core/java/com/android/internal/os/ProcessCpuTracker](https://android.googlesource.com/platform/frameworks/base/+/master/core/java/com/android/internal/os/ProcessCpuTracker.java)

- **Native层**：输入事件派发机制。针对InputEvent类型的ANR

  - [frameworks/base//services/core/jni/com_android_server_input_InputManagerService.cpp](https://android.googlesource.com/platform/frameworks/base/+/master/services/core/jni/com_android_server_input_InputManagerService.cpp)
  - [frameworks/native/services/inputflinger/InputDispatcher.cpp](https://android.googlesource.com/platform/frameworks/native/+/master/services/inputflinger/InputDispatcher.cpp)

下面我们会深入源码，分析ANR的监测和报告过程。

## 2.1 ANR的监测机制

### 2.1.1 Service处理超时

Service运行在应用程序的主线程，如果Service的执行时间超过**20秒**，则会引发ANR。

当发生Service ANR时，一般可以先排查一下在Service的生命周期函数中(onCreate(), onStartCommand()等)有没有做耗时的操作，譬如复杂的运算、IO操作等。
如果应用程序的代码逻辑查不出问题，就需要深入检查当前系统的状态：CPU的使用情况、系统服务的状态等，判断当时发生ANR进程是否受到系统运行异常的影响。

如何检测Service超时呢？Android是通过设置定时消息实现的。定时消息是由AMS的消息队列处理的(system_server的ActivityManager线程)。
AMS有Service运行的上下文信息，所以在AMS中设置一套超时检测机制也是合情合理的。

Service ANR机制相对最为简单，主体实现在[ActiveServices](https://android.googlesource.com/platform/frameworks/base/+/master/services/core/java/com/android/server/am/ActiveServices.java)中。
当Service的生命周期开始时，**bumpServiceExecutingLocked()**会被调用，紧接着会调用**scheduleServiceTimeoutLocked()**：

{% highlight java %}
void scheduleServiceTimeoutLocked(ProcessRecord proc) {
    ...
    Message msg = mAm.mHandler.obtainMessage(
            ActivityManagerService.SERVICE_TIMEOUT_MSG);
    msg.obj = proc;
    // 通过AMS.MainHandler抛出一个定时消息
    mAm.mHandler.sendMessageAtTime(msg,
         proc.execServicesFg ? (now+SERVICE_TIMEOUT) : (now+ SERVICE_BACKGROUND_TIMEOUT));
}
{% endhighlight %}

上述方法通过AMS.MainHandler抛出一个定时消息**SERVICE_TIMEOUT_MSG**：

- 前台进程中执行Service，超时时间是**SERVICE_TIMEOUT(20秒)**
- 后台进程中执行Service，超时时间是**SERVICE_BACKGROUND_TIMEOUT(200秒)**

当Service的生命周期结束时，会调用**serviceDoneExecutingLocked()**方法，之前抛出的**SERVICE_TIMEOUT_MSG**消息在这个方法中会被清除。
如果在超时时间内，**SERVICE_TIMEOUT_MSG**没有被清除，那么，AMS.MainHandler就会响应这个消息:

{% highlight java %}
case SERVICE_TIMEOUT_MSG: {
    // 判断是否在做dexopt操作， 该操作的比较耗时，允许再延长20秒
    if (mDidDexOpt) {
        mDidDexOpt = false;
        Message nmsg = mHandler.obtainMessage(SERVICE_TIMEOUT_MSG);
        nmsg.obj = msg.obj;
        mHandler.sendMessageDelayed(nmsg, ActiveServices.SERVICE_TIMEOUT);
        return;
    }
    mServices.serviceTimeout((ProcessRecord)msg.obj);
} break;
{% endhighlight %}

如果不是在做dexopt操作，**ActiveServices.serviceTimeout()**就会被调用：

{% highlight java %}
void serviceTimeout(ProcessRecord proc) {
    ...
    final long maxTime =  now -
              (proc.execServicesFg ? SERVICE_TIMEOUT : SERVICE_BACKGROUND_TIMEOUT);
    ...
    // 寻找运行超时的Service
    for (int i=proc.executingServices.size()-1; i>=0; i--) {
        ServiceRecord sr = proc.executingServices.valueAt(i);
        if (sr.executingStart < maxTime) {
            timeout = sr;
            break;
        }
       ...
    }
    ...
    // 判断执行Service超时的进程是否在最近运行进程列表，如果不在，则忽略这个ANR
    if (timeout != null && mAm.mLruProcesses.contains(proc)) {
        anrMessage = "executing service " + timeout.shortName;
    }
    ...
    if (anrMessage != null) {
        mAm.appNotResponding(proc, null, null, false, anrMessage);
    }
}
{% endhighlight %}

上述方法会找到当前进程已经超时的Service，经过一些判定后，决定要报告ANR，最终调用**AMS.appNotResponding()**方法。
走到这一步，ANR机制已经完成了监测报告任务，剩下的任务就是ANR结果的输出，我们称之为ANR的报告机制。
ANR的报告机制是通过**AMS.appNotResponding()**完成的，Broadcast和InputEvent类型的ANR最终也都会调用这个方法，我们后文再详细展开。

**至此，我们分析了Service的ANR机制：**

**通过定时消息跟踪Service的运行，当定时消息被响应时，说明Service还没有运行完成，这就意味着Service ANR。**

### 2.1.2 Broadcast处理超时

应用程序可以注册广播接收器，实现**BroadcastReceiver.onReceive()**方法来完成对广播的处理。
通常，这个方法是在主线程执行的，Android限定它执行时间不能超过**10秒**，否则，就会引发ANR。

**onReceive()**也可以调度在其他线程执行，通过**Context.registerReceiver(BroadcastReceiver, IntentFilter, String, Handler)**这个方法注册广播接收器，
可以指定一个处理的Handler，将**onReceive()**调度在非主线程执行。

**这里先把问题抛出来了：**

> 1. Android如何将广播投递给各个应用程序？
> 2. Android如何检测广播处理超时？

#### 广播消息的调度

AMS维护了两个广播队列[BroadcastQueue](https://android.googlesource.com/platform/frameworks/base/+/master/services/core/java/com/android/server/am/BroadcastQueue.java):

- **foreground queue**，前台队列的超时时间是10秒
- **background queue**，后台队列的超时时间是60秒

之所以有两个，就是因为要区分的不同超时时间。所有发送的广播都会进入到队列中等待调度，在发送广播时，可以通过**Intent.FLAG_RECEIVER_FOREGROUND**参数将广播投递到前台队列。
AMS线程会不断地从队列中取出广播消息派发到各个接收器(BroadcastReceiver)。当要派发广播时，AMS会调用**BroadcastQueue.scheduleBroadcastsLocked()**方法：

{% highlight java %}
public void scheduleBroadcastsLocked() {
    ...
    if (mBroadcastsScheduled) {
        return;
    }
    mHandler.sendMessage(mHandler.obtainMessage(BROADCAST_INTENT_MSG, this));
    mBroadcastsScheduled = true;
}
{% endhighlight %}

上述方法中，往AMS线程的消息队列发送**BROADCAST_INTENT_MSG**消息，由此也可以看到真正派发广播的是AMS线程(system_server进程中的ActivityManager线程)。
由于上述方法可能被并发调用，所以通过**mBroadcastsScheduled**这个变量来标识**BROADCAST_INTENT_MSG**是不是已经被AMS线程接收了，当已经抛出的消息还未被接受时，不需要重新抛出。
该消息被接收后的处理逻辑如下：

{% highlight java %}
public void handleMessage(Message msg) {
    switch (msg.what) {
        case BROADCAST_INTENT_MSG: {
            ...
            processNextBroadcast(true);
        } break;
        ...
    }
}
{% endhighlight %}

直接调用**BroadcastQueue.processNextBroadcast()**方法，fromMsg参数为true表示这是一次来自**BROADCAST_INTENT_MSG**消息的派发请求。
**BroadcastQueue.processNextBroadcast()**是派发广播消息最为核心的函数，代码量自然也不小，我们分成几个部分来分析：

{% highlight java %}
// processNextBroadcast部分1：处理非串行广播消息
final void  processNextBroadcast(boolean fromMsg) {
    ...
    // 1. 设置mBroadcastsScheduled
    if (fromMsg) {
        mBroadcastsScheduled = false;
    }
    // 2. 处理“并行广播消息”
    while (mParallelBroadcasts.size() > 0) {
        ...
        final int N = r.receivers.size();
        for (int i=0; i<N; i++) {
            Object target = r.receivers.get(i);
            deliverToRegisteredReceiverLocked(r, (BroadcastFilter)target, false);
        }
        addBroadcastToHistoryLocked(r);
    }
    // 3. 处理阻塞的广播消息
    if (mPendingBroadcast != null) {
        ...
        if (!isDead) {
            // isDead表示当前广播消息的进程的存活状态
            // 如果还活着，则返回该函数，继续等待下次派发
            return;
        }
        ...
    }
//未完待续
{% endhighlight %}

第一个部分是处理非"串行广播消息“，有以下几个步骤：

1. 设置mBroadcastsScheduled。该变量在前文说过，是对BROADCAST_INTENT_MSG进行控制。
   如果是响应BROADCAST_INTENT_MSG的派发调用，则将mBroadcastsScheduled设为false，
   表示本次BROADCAST_INTENT_MSG已经处理完毕，可以继续抛出下一次**BROADCAST_INTENT_MSG**消息了

2. 处理“并行广播消息”。广播接受器有“动态”和“静态”之分，通过**Context.registerReceiver()**注册的广播接收器为“动态”的，通过AndroidManifest.xml注册的广播接收器为“静态”的。
   广播消息有“并行”和“串行”之分，“并行广播消息”都会派发到“动态”接收器，“串行广播消息”则会根据实际情况派发到两种接收器。
   我们先不去探究Android为什么这么设计，只关注这两种广播消息派发的区别。在BroadcastQueue维护着两个队列：

   - **mParallelBroadcasts**，“并行广播消息”都会进入到此队列中排队。“并行广播消息”可以一次性派发完毕，即在一个循环中将广播派发到所有的“动态”接收器

   - **mOrderedBroadcasts**，“串行广播消息”都会进入到此队列中排队。“串行广播消息”需要轮侯派发，当一个接收器处理完毕后，会再抛出BROADCAST_INTENT_MSG消息，
     再次进入**BroadcastQueue.processNextBroadcast()**处理下一个

3. 处理阻塞的广播消息。有时候会存在一个广播消息派发不出去的情况，这个广播消息会保存在mPendingBroadcast变量中。新一轮的派发启动时，会判断接收该消息的进程是否还活着，
   如果接收进程还活着，那么就继续等待。否则，就放弃这个广播消息

接下来是最为复杂的一部分，处理“串行广播消息”，ANR监测机制只在这一类广播消息中才发挥作用，也就是说“并行广播消息”是不会发生ANR的。

{% highlight java %}
// processNextBroadcast部分2：从队列中取出“串行广播消息”
    do {
        r = mOrderedBroadcasts.get(0);
        // 1. 广播消息的第一个ANR监测机制
        if (mService.mProcessesReady && r.dispatchTime > 0) {
            if ((numReceivers > 0) &&
                (now > r.dispatchTime + (2*mTimeoutPeriod*numReceivers))) {
                broadcastTimeoutLocked(false); // forcibly finish this broadcast
                ...
        }
        // 2. 判断该广播消息是否处理完毕
        if (r.receivers == null || r.nextReceiver >= numReceivers ||
            r.resultAbort || forceReceive) {
            ...
            cancelBroadcastTimeoutLocked();
            ...
            mOrderedBroadcasts.remove(0);
            continue;
        }

    } while (r == null);
//未完待续
{% endhighlight %}

这部分是一个do-while循环，每次都从mOrderedBroadcasts队列中取出第一条广播消息进行处理。第一个Broadcast ANR监测机制千呼万唤总算是出现了：

1. 判定当前时间是否已经超过了`r.dispatchTime + 2×mTimeoutPeriod×numReceivers`:

    - dispatchTime表示这一系列广播消息开始派发的时间。“串行广播消息”是逐个接收器派发的，一个接收器处理完毕后，才开始处理下一个消息派发。
      开始派发到第一个接收器的时间就是dispatchTime。dispatchTime需要开始等广播消息派发以后才会设定，也就是说，第一次进入processNextBroadcast()时，
      dispatchTime=0,并不会进入该条件判断

    - mTimeoutPeriod由当前BroadcastQueue的类型决定(forground为10秒，background为60秒)。这个时间在初始化BroadcastQueue的时候就设置好了，
      本意是限定每一个Receiver处理广播的时间，这里利用它做了一个超时计算

    假设一个广播消息有2个接受器，mTimeoutPeriod是10秒，当2×10×2=40秒后，该广播消息还未处理完毕，就调用**broadcastTimeoutLocked()**方法，
    这个方法会判断当前是不是发生了ANR，我们后文再分析。

2. 如果广播消息是否已经处理完毕，则从mOrderedBroadcasts中移除，重新循环，处理下一条;否则，就会跳出循环。

以上代码块完成的主要任务是从队列中取一条“串行广播消息”，接下来就准备派发了：

{% highlight java %}
// processNextBroadcast部分3：串行广播消息的第二个ANR监测机制
    r.receiverTime = SystemClock.uptimeMillis();
    ...
    if (! mPendingBroadcastTimeoutMessage) {
        long timeoutTime = r.receiverTime + mTimeoutPeriod;
        ...
        setBroadcastTimeoutLocked(timeoutTime);
    }
//未完待续
{% endhighlight %}

取出“串行广播消息"后，一旦要开始派发，第二个ANR检测机制就出现了。**mPendingBroadcastTimeoutMessage**变量用于标识当前是否有阻塞的超时消息，
如果没有则调用**BroadcastQueue.setBroadcastTimeoutLocked()**：

{% highlight java %}
final void setBroadcastTimeoutLocked(long timeoutTime) {
    if (! mPendingBroadcastTimeoutMessage) {
        Message msg = mHandler.obtainMessage(BROADCAST_TIMEOUT_MSG, this);
        mHandler.sendMessageAtTime(msg, timeoutTime);
        mPendingBroadcastTimeoutMessage = true;
    }
}
{% endhighlight %}

通过设置一个定时消息**BROADCAST_TIMEOUT_MSG**来跟踪当前广播消息的执行情况，这种超时监测机制跟Service ANR很类似，也是抛到AMS线程的消息队列。
如果所有的接收器都处理完毕了，则会调用**cancelBroadcastTimeoutLocked()**清除该消息;否则，该消息就会响应，并调用**broadcastTimeoutLocked()**，
这个方法在第一种ANR监测机制的时候调用过，第二种ANR监测机制也会调用，我们留到后文分析。

设置完定时消息后，就开始派发广播消息了，首先是“动态”接收器：

{% highlight java %}
// processNextBroadcast部分4： 向“动态”接收器派发广播消息
    final Object nextReceiver = r.receivers.get(recIdx);
    // 动态接收器的类型都是BroadcastFilter
    if (nextReceiver instanceof BroadcastFilter) {
        BroadcastFilter filter = (BroadcastFilter)nextReceiver;
        deliverToRegisteredReceiverLocked(r, filter, r.ordered);
        ...
        return;
    }
//未完待续
{% endhighlight %}

“动态”接收器的载体进程一般是处于运行状态的，所以向这种类型的接收器派发消息相对简单，调用**BroadcastQueue.deliverToRegisteredReceiverLocked()**完成接下来的工作。
但“静态”接收器是在AndroidManifest.xml中注册的，派发的时候，可能广播接收器的载体进程还没有启动，所以，这种场景会复杂很多。

{% highlight java %}
// processNextBroadcast部分5： 向“静态”接收器派发广播消息
    // 静态接收器的类型都是 ResolveInfo
    ResolveInfo info = (ResolveInfo)nextReceiver;
    ...
    // 1. 权限检查
    ComponentName component = new ComponentName(
                info.activityInfo.applicationInfo.packageName,
                info.activityInfo.name);
    int perm = mService.checkComponentPermission(info.activityInfo.permission,
                r.callingPid, r.callingUid, info.activityInfo.applicationInfo.uid,
                info.activityInfo.exported);
    ...
    // 2. 获取接收器所在的进程
    ProcessRecord app = mService.getProcessRecordLocked(targetProcess,
                info.activityInfo.applicationInfo.uid, false);
    // 3. 进程已经启动
    if (app != null && app.thread != null) {
       ...
       processCurBroadcastLocked(r, app);
       return;
    }
    // 4. 进程还未启动
    if ((r.curApp=mService.startProcessLocked(targetProcess,
                info.activityInfo.applicationInfo, true,
                r.intent.getFlags() | Intent.FLAG_FROM_BACKGROUND,
                "broadcast", r.curComponent,
                (r.intent.getFlags()&Intent.FLAG_RECEIVER_BOOT_UPGRADE) != 0, false, false))
                        == null) {
        ...
        scheduleBroadcastsLocked();
        return;
    }
    // 5. 进程启动失败
    mPendingBroadcast = r;
    mPendingBroadcastRecvIndex = recIdx;
}
// processNextBroadcast完
{% endhighlight %}

1. “静态”接收器是ResolveInfo，需要通过PackageManager获取包信息，进行权限检查。权限检查的内容非常庞大，此处不表。

2. 经过一系列复杂的权限检查后，终于可以向目标接收器派发了。通过**AMS.getProcessRecordLocked()**获取广播接收器的进程信息

3. 如果`app.thread ！= null`，则进程已经启动，就可以调用**BroadcastQueue.processCurBroadcastLocked()**进行接下来的派发处理了

4. 如果进程还没有启动，则需要通过**AMS.startProcessLocked()**来启动进程，当前消息并未派发，调用**BroadcastQueue.scheduleBroadcastsLocked()**进入下一次的调度

5. 如果进程启动失败了，则当前消息记录成mPendingBroadcast，即阻塞的广播消息，等待下一次调度时处理

庞大的**processNextBroadcast()**终于完结了，它的功能就是对广播消息进行调度，该方法被设计得十分复杂而精巧，用于应对不同的广播消息和接收器的处理。

#### 广播消息的跨进程传递

调度是完成了，接下来，我们就来分析被调度广播消息如何到达应用程序。上文的分析中，最终有两个方法将广播消息派发出去：
**BroadcastQueue.deliverToRegisteredReceiverLocked()**和**BroadcastQueue.processCurBroadcastLocked()**。

我们先不展开这两个函数的逻辑，试想要将广播消息的从AMS线程所在的system_server进程传递到应用程序的进程，该怎么实现？
自然需要用到跨进程调用，Android中最常规的手段就是Binder机制。没错，广播消息派发到应用进程就是这么玩的。

对于应用程序已经启动(app.thread != null)的情况，会通过**IApplicationThread**发起跨进程调用，
调用关系如下：

    ActivityThread.ApplicationThread.scheduleReceiver()
    └── ActivityThread.handleReceiver()
        └── BroadcastReceiver.onReceive()

对于应用程序还未启动的情况，会调用**IIntentReceiver**发起跨进程调用，应用进程的实现在**LoadedApk.ReceiverDispatcher.IntentReceiver**中，
调用关系如下：

    LoadedApk.ReceiverDispatcher.IntentReceiver.performReceive()
    └── LoadedApk.ReceiverDispatcher.performReceiver()
        └── LoadedApk.ReceiverDispatcher.Args.run()
            └── BroadcastReceiver.onReceive()

最终，都会调用到**BroadcastReceiver.onReceive()**，在应用进程执行接收广播消息的具体动作。
对于“串行广播消息”而言，执行完了以后，还需要通知system_server进程，才能继续将广播消息派发到下一个接收器，这又需要跨进程调用了。
应用进程在处理完广播消息后，即在**BroadcastReceiver.onReceive()**执行完毕后，会调用**BroadcastReceiver.PendingResult.finish()**，
接下来的调用关系如下：

    BroadcastReceiver.PendingResult.finish()
    └── BroadcastReceiver.PendingResult.sendFinished()
        └── IActivityManager.finishReceiver()
            └── ActivityManagerService.finishReceiver()
                └── BroadcastQueue.processNextBroadcat()

通过**IActivityManager**发起了一个从应用进程到system_server进程的调用，最终在AMS线程中，又走到了**BroadcastQueue.processNextBroadcat()**,
开始下一轮的调度。

#### broadcastTimeoutLocked()方法

前文说过，两种ANR机制最终都会调用**BroadcastQueue.broadcastTimeoutLocked()**方法，
第一种ANR监测生效时，会将fromMsg设置为false;第二种ANR监测生效时，会将fromMsg参数为True时，表示当前正在响应**BROADCAST_TIMEOUT_MSG**消息。

{% highlight java %}
final void broadcastTimeoutLocked(boolean fromMsg) {
    // 1. 设置mPendingBroadcastTimeoutMessage
    if (fromMsg) {
        mPendingBroadcastTimeoutMessage = false;
    }
    ...
    // 2. 判断第二种ANR机制是否超时
    BroadcastRecord r = mOrderedBroadcasts.get(0);
    if (fromMsg) {
        long timeoutTime = r.receiverTime + mTimeoutPeriod;
        if (timeoutTime > now) {
            setBroadcastTimeoutLocked(timeoutTime);
            return;
        }
    }
    ...
    // 3. 已经超时，则结束对当前接收器，开始新一轮调度
    finishReceiverLocked(r, r.resultCode, r.resultData,
                r.resultExtras, r.resultAbort, false);
    scheduleBroadcastsLocked();

    // 4. 抛出绘制ANR对话框的消息
    if (anrMessage != null) {
        mHandler.post(new AppNotResponding(app, anrMessage));
    }
}
{% endhighlight %}

1. **mPendingBroadcastTimeoutMessage**标识是否存在未处理的**BROADCAST_TIMEOUT_MSG**消息，
   将其设置成false，允许继续抛出**BROADCAST_TIMEOUT_MSG**消息

2. 每次将广播派发到接收器，都会将r.receiverTime更新，如果判断当前还未超时，则又抛出一个**BROADCAST_TIMEOUT_MSG**消息。
   正常情况下，所有接收器处理完毕后，才会清除**BROADCAST_TIMEOUT_MSG**;否则，每进行一次广播消息的调度，都会抛出**BROADCAST_TIMEOUT_MSG**消息

3. 判断已经超时了，说明当前的广播接收器还未处理完毕，则结束掉当前的接收器，开始新一轮广播调度

4. 最终，发出绘制ANR对话框的消息

**至此，我们回答了前文提出的两个问题:**

**AMS维护着广播队列BroadcastQueue，AMS线程不断从队列中取出消息进行调度，完成广播消息的派发。**
**在派发“串行广播消息”时，会抛出一个定时消息BROADCAST_TIMEOUT_MSG，在广播接收器处理完毕后，AMS会将定时消息清除。**
**如果BROADCAST_TIMEOUT_MSG得到了响应，就会判断是否广播消息处理超时，最终通知ANR的发生。**

### 2.1.3 Input处理超时

应用程序可以接收输入事件(按键、触屏、轨迹球等)，当5秒内没有处理完毕时，则会引发ANR。

**如果Broadcast ANR一样，我们抛出Input ANR的几个问题：**

> 1. 输入事件经历了一些什么工序才能被派发到应用的界面？
> 2. 如何检测到输入时间处理超时？

输入事件最开始由硬件设备(譬如按键或触摸屏幕)发起，Android有一套输入子系统来发现各种输入事件，
这些事件最终都会被[InputDispatcher](https://android.googlesource.com/platform/frameworks/native/+/master/services/inputflinger/InputDispatcher.cpp)分发到各个需要接收事件的窗口。
那么，窗口如何告之InputDispatcher自己需要处理输入事件呢？Android通过[InputChannel](https://android.googlesource.com/platform/frameworks/base/+/master/core/java/android/view/InputChannel.java)
连接InputDispatcher和窗口，InputChannel其实是封装后的Linux管道(Pipe)。
每一个窗口都会有一个独立的InputChannel，窗口需要将这个InputChannel注册到InputDispatcher中:

{% highlight c %}
status_t InputDispatcher::registerInputChannel(const sp<InputChannel>& inputChannel,
        const sp<InputWindowHandle>& inputWindowHandle, bool monitor) {
    ...
    sp<Connection> connection = new Connection(inputChannel, inputWindowHandle, monitor);
    int fd = inputChannel->getFd();
    mConnectionsByFd.add(fd, connection);
    ...
    mLooper->addFd(fd, 0, ALOOPER_EVENT_INPUT, handleReceiveCallback, this);
    ...
    mLooper->wake();
    return OK;
}
{% endhighlight %}

对于InputDispatcher而言，每注册一个InputChannel都被视为一个Connection，通过文件描述符来区别。InputDispatcher是一个消息处理循环，当有新的Connection时，就需要唤醒消息循环队列进行处理。

输入事件的类型有很多，按键、轨迹球、触屏等，Android对这些事件进行了分类，处理这些事件的窗口也被赋予了一个类型(**targetType**)：Foucused或Touched，
如果当前输入事件是按键类型，则寻找Focused类型的窗口;如果当前输入事件类型是触摸类型，则寻找Touched类型的窗口。
InputDispatcher需要经过以下复杂的调用关系，才能把一个输入事件派发出去(调用关系以按键事件为例，触屏事件的调用关系类似)：

    InputDispatcherThread::threadLoop()
    └── InputDispatcher::dispatchOnce()
        └── InputDispatcher::dispatchOnceInnerLocked()
            └── InputDispatcher::dispatchKeyLocked()
                └── InputDispatcher::dispatchEventLocked()
                    └── InputDispatcher::prepareDispatchCycleLocked()
                        └── InputDispatcher::enqueueDispatchEntriesLocked()
                            └── InputDispatcher::startDispatchCycleLocked()
                                └── InputPublisher::publishKeyEvent()

具体每个函数的实现逻辑此处不表。我们提炼出几个关键点：

- InputDispatcherThread是一个线程，它处理一次消息的派发
- 输入事件作为一个消息，需要排队等待派发，每一个Connection都维护两个队列：
  - outboundQueue: 等待发送给窗口的事件。每一个新消息到来，都会先进入到此队列
  - waitQueue: 已经发送给窗口的事件
- publishKeyEvent完成后，表示事件已经派发了，就将事件从outboundQueue挪到了waitQueue

事件经过这么一轮处理，就算是从InputDispatcher派发出去了，但事件是不是被窗口收到了，还需要等待接收方的“finished”通知。
在向InputDispatcher注册InputChannel的时候，同时会注册一个回调函数**handleReceiveCallback()**:

{% highlight c %}
int InputDispatcher::handleReceiveCallback(int fd, int events, void* data) {
    ...
    for (;;) {
        ...
        status = connection->inputPublisher.receiveFinishedSignal(&seq, &handled);
        if (status) {
            break;
        }
        d->finishDispatchCycleLocked(currentTime, connection, seq, handled);
        ...
    }
    ...
    d->unregisterInputChannelLocked(connection->inputChannel, notify);
}
{% endhighlight %}

当收到的status为OK时，会调用**finishDispatchCycleLocked()**来完成一个消息的处理：

    InputDispatcher::finishDispatchCycleLocked()
    └── InputDispatcher::onDispatchCycleFinishedLocked()
        └── InputDispatcher::doDispatchCycleFinishedLockedInterruptible()
            └── InputDispatcher::startDispatchCycleLocked()

调用到**doDispatchCycleFinishedLockedInterruptible()**方法时，会将已经成功派发的消息从waitQueue中移除，
进一步调用会**startDispatchCycleLocked**开始派发新的事件。

**至此，我们回答了第一个问题：**

**一个正常的输入事件会经过从outboundQueue挪到waitQueue的过程，表示消息已经派发出去;再经过从waitQueue中移除的过程，表示消息已经被窗口接收。**
**InputDispatcher作为中枢，不停地在递送着输入事件，当一个事件无法得到处理的时候，InputDispatcher不能就此死掉啊，否则系统也太容易崩溃了。**
**InputDispatcher的策略是放弃掉处理不过来的事件，并发出通知(这个通知机制就是ANR)，继续进行下一轮消息的处理。**

> <b>理解输入事件分发模型，我们可以举一个生活中的例子：</b><br/>
> 每一个输入事件可以比做一个快递，InputDispatcher就像一个快递中转站，窗口就像是收件人，InputChannel就像是快递员。
> 所有快递都会经过中转站中处理，中转站需要知道每一个快递的收件人是谁，通过快递员将快递发送到具体的收件人。
> 这其中有很多场景导致快递不能及时送到：譬如联系不到收件人;快递很多，快递员会忙不过来;快递员受伤休假了等等...
> 这时候快递员就需要告知中转站：有快递无法及时送到了。中转站在收到快递员的通知后，一边继续派发其他快递，一边报告上级。

在了解输入事件分发模型之后，我们可以见识一下ANR机制了。在派发事件时，**dispatchKeyLocked()**和**dispatchMotionLocked()**，
需要找到当前的焦点窗口,焦点窗口才是最终接收事件的地方，找窗口的过程就会判断是否已经发生了ANR：

    InputDispatcher::findFocusedWindowTargetsLocked()
    InputDispatcher::findTouchedWindowTargetsLocked()
    └── InputDispatcher::handleTargetsNotReadyLocked()
        └── InputDispatcher::onANRLocked()
            └── InputDispatcher::doNotifyANRLockedInterruptible()
                └── NativeInputManager::notifyANR()

- 首先，会调用**findFocusedWindowTargetsLocked()**或**findTouchedWindowTargetsLocked()**寻找接收输入事件的窗口。

  在找到窗口以后，会调用[**checkWindowReadyForMoreInputLocked()**](https://android.googlesource.com/platform/frameworks/native/+/master/services/inputflinger/InputDispatcher.cpp#1633)
  检查窗口是否有能力再接收新的输入事件，会有一系列的场景阻碍事件的继续派发：

  - **场景1:** 窗口处于paused状态，不能处理输入事件

    "Waiting because the [targetType] window is paused."

  - **场景2:** 窗口还未向InputDispatcher注册，无法将事件派发到窗口

    "Waiting because the [targetType] window's input channel is not
     registered with the input dispatcher.  The window may be in the process
     of being removed."

  - **场景3:** 窗口和InputDispatcher的连接已经中断，即InputChannel不能正常工作

    "Waiting because the [targetType] window's input connection is [status].
     The window may be in the process of being removed."

  - **场景4:** InputChannel已经饱和，不能再处理新的事件

    "Waiting because the [targetType] window's input channel is full.
     Outbound queue length: %d.  Wait queue length: %d."

  - **场景5:** 对于按键类型(KeyEvent)的输入事件，需要等待上一个事件处理完毕

    "Waiting to send key event because the [targetType] window has not
     finished processing all of the input events that were previously
     delivered to it.  Outbound queue length: %d.  Wait queue length: %d."

  - **场景6:** 对于触摸类型(TouchEvent)的输入事件，可以立即派发到当前的窗口，因为TouchEvent都是发生在用户当前可见的窗口。但有一种情况，
    如果当前应用由于队列有太多的输入事件等待派发，导致发生了ANR，那TouchEvent事件就需要排队等待派发。

    "Waiting to send non-key event because the %s window has not
     finished processing certain input events that were delivered to it over
     %0.1fms ago.  Wait queue length: %d.  Wait queue head age: %0.1fms."

- 然后，上述有任何一个场景发生了，则输入事件需要继续等待，紧接着就会调用**handleTargetsNotReadyLocked()**来判断是不是已经的等待超时了：

{% highlight c %}
int32_t InputDispatcher::handleTargetsNotReadyLocked(nsecs_t currentTime,
        const EventEntry* entry,
        const sp<InputApplicationHandle>& applicationHandle,
        const sp<InputWindowHandle>& windowHandle,
        nsecs_t* nextWakeupTime, const char* reason) {
    ...
    if (currentTime >= mInputTargetWaitTimeoutTime) {
        onANRLocked(currentTime, applicationHandle, windowHandle,
            entry->eventTime, mInputTargetWaitStartTime, reason);
        *nextWakeupTime = LONG_LONG_MIN;
        return INPUT_EVENT_INJECTION_PENDING;
    }
    ...
}
{% endhighlight %}

- 最后，如果当前事件派发已经超时，则说明已经检测到了ANR，调用**onANRLocked()**方法，然后将nextWakeupTime设置为最小值，马上开始下一轮调度。
  在[**onANRLocked()**](https://android.googlesource.com/platform/frameworks/native/+/master/services/inputflinger/InputDispatcher.cpp#3430)方法中，
  会保存ANR的一些状态信息，调用**doNotifyANRLockedInterruptible()**，进一步会调用到JNI层的
  [**NativeInputManager::notifyANR()**](https://android.googlesource.com/platform/frameworks/base/+/master/services/core/jni/com_android_server_input_InputManagerService.cpp#598)方法，
  它的主要功能就是衔接Native层和Java层，直接调用Java层的**InputManagerService.notifyANR()**方法。

{% highlight c %}
nsecs_t NativeInputManager::notifyANR(
    const sp<InputApplicationHandle>& inputApplicationHandle,
    const sp<InputWindowHandle>& inputWindowHandle,
    const String8& reason) {
    ...
    JNIEnv* env = jniEnv();

    // 将应用程序句柄、窗口句柄、ANR原因字符串，转化为Java层的对象
    jobject inputApplicationHandleObj =
            getInputApplicationHandleObjLocalRef(env, inputApplicationHandle);
    jobject inputWindowHandleObj =
            getInputWindowHandleObjLocalRef(env, inputWindowHandle);
    jstring reasonObj = env->NewStringUTF(reason.string());

    // 调用Java层的InputManagerService.notifyANR()方法
    jlong newTimeout = env->CallLongMethod(mServiceObj,
                gServiceClassInfo.notifyANR, inputApplicationHandleObj, inputWindowHandleObj,
                reasonObj);
    ...
    return newTimeout;
}
{% endhighlight %}

**至此，ANR的处理逻辑转交到了Java层。**底层(Native)发现一旦有输入事件派发超时，就会通知上层(Java)，上层收到ANR通知后，决定是否终止当前输入事件的派发。

发生ANR时，Java层最开始的入口是**InputManagerService.notifyANR()**，它是直接被Native层调用的。我们先把ANR的Java层调用关系列出来：

    InputManagerService.notifyANR()
    └── InputMonitor.notifyANR()
        ├── IApplicationToken.keyDispatchingTimedOut()
        │   └── ActivityRecord.keyDispatchingTimedOut()
        │       └── AMS.inputDispatchingTimedOut()
        │           └── AMS.appNotResponding()
        │
        └── AMS.inputDispatchingTimedOut()
            └── AMS.appNotResponding()

- **InputManagerService.notifyANR()**只是为Native层定义了一个接口，它直接调用**InputMonitor.notifyANR()**。
  如果该方法的返回值等于0,则放弃本次输入事件;如果大于0,则表示需要继续等待的时间。

{% highlight java %}
public long notifyANR(InputApplicationHandle inputApplicationHandle,
      InputWindowHandle inputWindowHandle, String reason) {
    ...
    if (appWindowToken != null && appWindowToken.appToken != null) {
        // appToken实际上就是当前的ActivityRecord。
        // 如果发生ANR的Activity还存在，则直接通过ActivityRecord通知事件派发超时
        boolean abort = appWindowToken.appToken.keyDispatchingTimedOut(reason);
        if (! abort) {
            return appWindowToken.inputDispatchingTimeoutNanos;
        }
    } else if (windowState != null) {
        // 如果发生ANR的Activity已经销毁了，则通过AMS通知事件派发超时
        long timeout = ActivityManagerNative.getDefault().inputDispatchingTimedOut(
                        windowState.mSession.mPid, aboveSystem, reason);
         if (timeout >= 0) {
             return timeout;
         }
    }
    return 0; // abort dispatching
}
{% endhighlight %}

- 上述方法中有两种不同的调用方式，但最终都会交由**AMS.inputDispatchingTimedOut()**处理。AMS有重载的**inputDispatchingTimedOut()**方法，他们的参数不一样。
  ActivityRecord调用时，可以传入的信息更多一点(当前发生ANR的界面是哪一个)。

{% highlight java %}
@Override
public long inputDispatchingTimedOut(int pid, final boolean aboveSystem, String reason) {
    // 1. 根据进程号获取到ProcessRecord
    proc = mPidsSelfLocked.get(pid);
    ...
    // 2. 获取超时时间
    // 测试环境下的超时时间是INSTRUMENTATION_KEY_DISPATCHING_TIMEOUT(60秒)，
    // 正常环境下的超时时间是KEY_DISPATCHING_TIMEOUT(5秒)
    timeout = getInputDispatchingTimeoutLocked(proc);
    // 调用重载的函数，如果返回True，则表示需要中断当前的事件派发;
    if (!inputDispatchingTimedOut(proc, null, null, aboveSystem, reason)) {
        return -1;
    }
    // 3. 返回继续等待的时间，这个值会传递到Native层
    return timeout;
}

public boolean inputDispatchingTimedOut(final ProcessRecord proc,
        final ActivityRecord activity, final ActivityRecord parent,
        final boolean aboveSystem, String reason) {
    ...
    // 1. 发生ANR进程正处于调试状态，不需要中断事件
    if (proc.debugging) {
        return false;
    }
    // 2. 当前正在做dexopt操作，这会比较耗时，不需要中断
    if (mDidDexOpt) {
        // Give more time since we were dexopting.
        mDidDexOpt = false;
        return false;
    }
    // 3. 发生ANR的进程是测试进程，需要中断，但不在UI界面显示ANR信息判断
    if (proc.instrumentationClass != null) {
        ...
        finishInstrumentationLocked(proc, Activity.RESULT_CANCELED, info);
        return true;
    }

    // 4. 通知UI界面显示ANR信息
    mHandler.post(new Runnable() {
        @Override
        public void run() {
            appNotResponding(proc, activity, parent, aboveSystem, annotation);
        }
    });
    ...
    return true;
}
{% endhighlight %}

**至此，我们回答了第二个问题：**

**在InputDispatcher派发输入事件时，会寻找接收事件的窗口，如果无法正常派发，则可能会导致当前需要派发的事件超时(默认是5秒)。**
**Native层发现超时了，会通知Java层，Java层经过一些处理后，会反馈给Native层，是继续等待还是丢弃当前派发的事件。**

### 2.1.4 小结

ANR监测机制包含三种：

- **Service ANR**，前台进程中Service生命周期不能超过**20秒**，后台进程中Service的生命周期不能超过**200秒**。
  在启动Service时，抛出定时消息**SERVICE_TIMEOUT_MSG**或**SERVICE_BACKGOURND_TIMEOUT_MSG**，如果定时消息响应了，则说明发生了ANR

- **Broadcast ANR**，前台的“串行广播消息”必须在**10秒**内处理完毕，后台的“串行广播消息”必须在**60秒**处理完毕，
  每派发串行广播消息到一个接收器时，都会抛出一个定时消息**BROADCAST_TIMEOUT_MSG**，如果定时消息响应，则判断是否广播消息处理超时，超时就说明发生了ANR

- **Input ANR**，输入事件必须在**5秒**内处理完毕。在派发一个输入事件时，会判断当前输入事件是否需要等待，如果需要等待，则判断是否等待已经超时，超时就说明发生了ANR

ANR监测机制实际上是对应用程序主线程的要求，要求主线成必须在限定的时间内，完成对几种操作的响应;否则，就可以认为应用程序主线程失去响应能力。

从ANR的三种监测机制中，我们看到不同超时机制的设计：

Service和Broadcast都是由AMS调度，利用Handler和Looper，设计了一个TIMEOUT消息交由AMS线程来处理，整个超时机制的实现都是在Java层；
InputEvent由InputDispatcher调度，待处理的输入事件都会进入队列中等待，设计了一个等待超时的判断，超时机制的实现在Native层。


## 2.2 ANR的报告机制

无论哪种类型的ANR发生以后，最终都会调用 *AMS.appNotResponding()* 方法，所谓“殊途同归”。这个方法的职能就是向用户或开发者报告ANR发生了。
最终的表现形式是：弹出一个对话框，告诉用户当前某个程序无响应;输入一大堆与ANR相关的日志，便于开发者解决问题。

最终形式我们见过很多，但输出日志的原理是什么，未必所有人都了解，下面我们就来认识一下是如何输出ANR日志的。

{% highlight java %}
final void appNotResponding(ProcessRecord app, ActivityRecord activity,
        ActivityRecord parent, boolean aboveSystem, final String annotation) {
    // app: 当前发生ANR的进程
    // activity: 发生ANR的界面
    // parent: 发生ANR的界面的上一级界面
    // aboveSystem:
    // annotation: 发生ANR的原因
    ...
    // 1. 更新CPU使用信息。ANR的第一次CPU信息采样
    updateCpuStatsNow();
    ...
    // 2. 填充firstPids和lastPids数组。从最近运行进程(Last Recently Used)中挑选：
    //    firstPids用于保存ANR进程及其父进程，system_server进程和persistent的进程(譬如Phone进程)
    //    lastPids用于保存除firstPids外的其他进程
    firstPids.add(app.pid);
    int parentPid = app.pid;
    if (parent != null && parent.app != null && parent.app.pid > 0)
        parentPid = parent.app.pid;
    if (parentPid != app.pid) firstPids.add(parentPid);
    if (MY_PID != app.pid && MY_PID != parentPid) firstPids.add(MY_PID);

    for (int i = mLruProcesses.size() - 1; i >= 0; i--) {
        ProcessRecord r = mLruProcesses.get(i);
        if (r != null && r.thread != null) {
            int pid = r.pid;
            if (pid > 0 && pid != app.pid && pid != parentPid && pid != MY_PID) {
                if (r.persistent) {
                    firstPids.add(pid);
                } else {
                    lastPids.put(pid, Boolean.TRUE);
                }
            }
        }
    }
    ...
    // 3. 打印调用栈
    File tracesFile = dumpStackTraces(true, firstPids, processCpuTracker, lastPids,
                NATIVE_STACKS_OF_INTEREST);
    ...
    // 4. 更新CPU使用信息。ANR的第二次CPU使用信息采样
    updateCpuStatsNow();
    ...
    // 5. 显示ANR对话框
    Message msg = Message.obtain();
    HashMap<String, Object> map = new HashMap<String, Object>();
    msg.what = SHOW_NOT_RESPONDING_MSG;
    ...
    mHandler.sendMessage(msg);
}
{% endhighlight %}

该方法的主体逻辑可以分成五个部分来看：

1. 更新CPU的统计信息。这是发生ANR时，第一次CPU使用信息的采样，采样数据会保存在mProcessStats这个变量中

2. 填充firstPids和lastPids数组。当前发生ANR的应用会首先被添加到firstPids中，这样打印函数栈的时候，当前进程总是在trace文件的最前面

3. 打印函数调用栈(StackTrace)。具体实现由dumpStackTraces()函数完成

4. 更新CPU的统计信息。这是发生ANR时，第二次CPU使用信息的采样，两次采样的数据分别对应ANR发生前后的CPU使用情况

5. 显示ANR对话框。抛出**SHOW_NOT_RESPONDING_MSG**消息，AMS.MainHandler会处理这条消息，显示AppNotRespondingDialog

当然，除了主体逻辑，发生ANR时还会输出各种类别的日志：

- **event log**，通过检索"am_anr"关键字，可以找到发生ANR的应用
- **main log**，通过检索"ANR in "关键字，可以找到ANR的信息，日志的上下文会包含CPU的使用情况
- **dropbox**，通过检索"anr"类型，可以找到ANR的信息
- **traces**, 发生ANR时，各进程的函数调用栈信息

我们分析ANR问题，往往是从main log中的CPU使用情况和traces中的函数调用栈开始。所以，更新CPU的使用信息updateCpuStatsNow()方法和打印函数栈dumpStackTraces()方法，是系统报告ANR问题关键所在。

### 2.2.1 CPU的使用情况

**AMS.updateCpuStatsNow()**方法的实现不在这里列出了，只需要知道更新CPU使用信息的间隔最小是5秒，即如果5秒内连续调用updateCpuStatsNow()方法，其实是没有更新CPU使用信息的。

CPU使用信息由[ProcessCpuTracker](https://android.googlesource.com/platform/frameworks/base/+/master/core/java/com/android/internal/os/ProcessCpuTracker.java)这个类维护，
每次调用**ProcessCpuTracker.update()**方法，就会读取设备节点 */proc* 下的文件，来更新CPU使用信息，具体有以下几个维度：

- **CPU的使用时间**: 读取 */proc/stat*

  - user： 用户进程的CPU使用时间
  - nice： 降低过优先级进程的CPU使用时间。Linux进程都有优先级，这个优先级可以进行动态调整，譬如进程初始优先级的值设为10,运行时降低为8,那么，修正值-2就定义为nice。
           Android将user和nice这两个时间归类成user
  - sys： 内核进程的CPU使用时间
  - idle： CPU空闲的时间
  - wait： CPU等待IO的时间
  - hw irq： 硬件中断的时间。如果外设（譬如硬盘）出现故障，需要通过硬件终端通知CPU保存现场，发生上下文切换的时间就是CPU的硬件中断时间
  - sw irg： 软件中断的时间。同硬件中断一样，如果软件要求CPU中断，则上下文切换的时间就是CPU的软件中断时间

- **CPU负载**: 读取 */proc/loadavg*, 统计最近1分钟，5分钟，15分钟内，CPU的平均活动进程数。
  CPU的负载可以比喻成超市收银员负载，如果有1个人正在买单，有2个人在排队，那么该收银员的负载就是3。
  在收银员工作时，不断会有人买单完成，也不断会有人排队，可以在固定的时间间隔内(譬如，每隔5秒)统计一次负载，那么，就可以统计出一段时间内的平均负载。

- **页错误信息**：
  进程的CPU使用率最后输出的“faults: xxx minor/major”部分表示的是页错误次数，当次数为0时不显示。
  major是指Major Page Fault(主要页错误，简称MPF)，内核在读取数据时会先后查找CPU的高速缓存和物理内存，如果找不到会发出一个MPF信息，请求将数据加载到内存。
  minor是指Minor Page Fault(次要页错误，简称MnPF)，磁盘数据被加载到内存后，内核再次读取时，会发出一个MnPF信息。
  一个文件第一次被读写时会有很多的MPF，被缓存到内存后再次访问MPF就会很少，MnPF反而变多，这是内核为减少效率低下的磁盘I/O操作采用的缓存技术的结果。

### 2.2.2 函数调用栈

**AMS.dumpStackTraces()**方法用于打印进程的函数调用栈，该方法的主体逻辑如下：

{% highlight java %}
private static void dumpStackTraces(String tracesPath, ArrayList<Integer> firstPids,
            ProcessCpuTracker processCpuTracker, SparseArray<Boolean> lastPids, String[] nativeProcs) {
    ...
    // 1. 对firstPids数组中的进程发送SIGNAL_QUIT。
    //    进程在收到SIGNAL_QUIT后，会打印函数调用栈
    int num = firstPids.size();
    for (int i = 0; i < num; i++) {
        synchronized (observer) {
            Process.sendSignal(firstPids.get(i), Process.SIGNAL_QUIT);
            observer.wait(200);  // Wait for write-close, give up after 200msec
        }
    }
    ...
    // 2. 打印Native进程的函数调用栈
    int[] pids = Process.getPidsForCommands(nativeProcs);
    if (pids != null) {
        for (int pid : pids) {
            Debug.dumpNativeBacktraceToFile(pid, tracesPath);
        }
    }
    ...
    // 3. 更新CPU的使用情况
    processCpuTracker.init();
    System.gc();
    processCpuTracker.update();
    processCpuTracker.wait(500); // measure over 1/2 second.
    processCpuTracker.update();

    // 4. 对lastPids数组中的进程发送SIGNAL_QUIT
    //    只有处于工作状态的lastPids进程，才会收到SIGNAL_QUIT，打印函数调用栈
    final int N = processCpuTracker.countWorkingStats();
    int numProcs = 0;
    for (int i=0; i<N && numProcs<5; i++) {
    ProcessCpuTracker.Stats stats = processCpuTracker.getWorkingStats(i);
    if (lastPids.indexOfKey(stats.pid) >= 0) {
        numProcs++;
        Process.sendSignal(stats.pid, Process.SIGNAL_QUIT);
        observer.wait(200);  // Wait for write-close, give up after 200msec
    }
}
{% endhighlight %}

该方法有几个重要的逻辑(Native进程的函数调用栈此处不表)：

- 向进程发送**SIGNAL_QUIT**信号，进程在收到这个信号后，就会打印函数调用栈，默认输出到 */data/anr/traces.txt* 文件中，
  当然也可以配置 **dalvik.vm.stack-trace-file** 这个系统属性来指定输出函数调用栈的位置

- traces文件中包含很多进程的函数调用栈，这是由firstPids和lastPids数组控制的，在最终的traces文件中，firstPids中的进程是先打印的，
  而且当前发生ANR的进程又是排在firstPids的第一个，所以，当我们打开traces文件，第一个看到的就是当前发生ANR的应用进程

# 3. 问题分析方法

分析ANR问题，有三大利器：Logcat，traces和StrictMode。
在[StrictMode机制]()一文中，我们介绍过StrictMode的实现机制以及用途，本文中不讨论利用StrictMode来解决ANR问题，但各位读者需要有这个意识。
在[Watchdog机制以及问题分析](http://duanqz.github.io/android%E7%B3%BB%E7%BB%9F%E5%8E%9F%E7%90%86/2015/10/12/Watchdog-Analysis/)一文中，我们介绍过logcat和traces这两种日志的用途。
分析ANR问题同Watchdog问题一样，都需要经过日志获取、问题定位和场景还原三个步骤。

## 3.1 日志获取

我们在上文中分析过，ANR报告机制的重要职能就是输出日志，
这些日志如何取到呢？请参见[日志获取](http://duanqz.github.io/android%E7%B3%BB%E7%BB%9F%E5%8E%9F%E7%90%86/2015/10/12/Watchdog-Analysis/#tocAnchor-1-6-1)

## 3.2 问题定位

通过在`event log`中检索 **am_anr** 关键字，就可以找到发生ANR的进程，譬如以下日志：

	10-16 00:48:27 820 907 I am_anr: [0,29533,com.android.systemui,1082670605,Broadcast of Intent { act=android.intent.action.TIME_TICK flg=0x50000114 (has extras) }]

表示在 **10-16 00:48:27** 这个时刻，PID为 **29533** 进程发生了ANR，进程名是 **com.android.systemui**。

接下来可以在`system log`检索 **ANR in** 关键字，找到发生ANR前后的CPU使用情况：

	10-16 00:50:10 820 907 E ActivityManager: ANR in com.android.systemui, time=130090695
    10-16 00:50:10 820 907 E ActivityManager: Reason: Broadcast of Intent { act=android.intent.action.TIME_TICK flg=0x50000114 (has extras) }
    10-16 00:50:10 820 907 E ActivityManager: Load: 30.4 / 22.34 / 19.94
    10-16 00:50:10 820 907 E ActivityManager: Android time :[2015-10-16 00:50:05.76] [130191,266]
    10-16 00:50:10 820 907 E ActivityManager: CPU usage from 6753ms to -4ms ago:
    10-16 00:50:10 820 907 E ActivityManager:   47% 320/netd: 3.1% user + 44% kernel / faults: 14886 minor 3 major
    10-16 00:50:10 820 907 E ActivityManager:   15% 10007/com.sohu.sohuvideo: 2.8% user + 12% kernel / faults: 1144 minor
    10-16 00:50:10 820 907 E ActivityManager:   13% 10654/hif_thread: 0% user + 13% kernel
    10-16 00:50:10 820 907 E ActivityManager:   11% 175/mmcqd/0: 0% user + 11% kernel
	10-16 00:50:10 820 907 E ActivityManager:   5.1% 12165/app_process: 1.6% user + 3.5% kernel / faults: 9703 minor 540 major
	10-16 00:50:10 820 907 E ActivityManager:   3.3% 29533/com.android.systemui: 2.6% user + 0.7% kernel / faults: 8402 minor 343 major
	10-16 00:50:10 820 907 E ActivityManager:   3.2% 820/system_server: 0.8% user + 2.3% kernel / faults: 5120 minor 523 major
	10-16 00:50:10 820 907 E ActivityManager:   2.5% 11817/com.netease.pomelo.push.l.messageservice_V2: 0.7% user + 1.7% kernel / faults: 7728 minor 687 major
    10-16 00:50:10 820 907 E ActivityManager:   1.6% 11887/com.android.email: 0.5% user + 1% kernel / faults: 6259 minor 587 major
    10-16 00:50:10 820 907 E ActivityManager:   1.4% 11854/com.android.settings: 0.7% user + 0.7% kernel / faults: 5404 minor 471 major
    10-16 00:50:10 820 907 E ActivityManager:   1.4% 11869/android.process.acore: 0.7% user + 0.7% kernel / faults: 6131 minor 561 major
    10-16 00:50:10 820 907 E ActivityManager:   1.3% 11860/com.tencent.mobileqq: 0.1% user + 1.1% kernel / faults: 5542 minor 470 major
    ...
    10-16 00:50:10 820 907 E ActivityManager:  +0% 12832/cat: 0% user + 0% kernel
    10-16 00:50:10 820 907 E ActivityManager:  +0% 13211/zygote64: 0% user + 0% kernel
    10-16 00:50:10 820 907 E ActivityManager: 87% TOTAL: 3% user + 18% kernel + 64% iowait + 0.5% softirq

这一段日志对于Android开发人员而言，实在太熟悉不过了，它包含的信息量巨大：

- **发生ANR的时间**。event log中，ANR的时间是 **00：48：27**，因为**AMS.appNotResponding()**首先会打印event log，然后再打印system log，
  所以，在system log中，找到ANR的时间是 **00:50:10**。可以从这个时间点之前的日志中，还原ANR出现时系统的运行状态

- **打印ANR日志的进程**。ANR日志都是在system_server进程的AMS线程打印的，在event log和system log中，都能看到 **820** 和 **907**，
  所以system_server的PID是 **802**，AMS线程的TID是 **907**。ANR的监测机制实现在AMS线程，分析一些受系统影响的ANR，需要知道system_server进程的运行状态

- **发生ANR的进程**。**ANR in**关键字就表明了当前ANR的进程是com.android.system.ui，通过event log，知道进程的PID是 **29533**

- **发生ANR的原因**。**Reason**关键字表明了当前发生ANR的原因是，处理TIME_TICK广播消息超时。
  隐含的意思是TIME_TICK是一个串行广播消息，在 **29533** 的主线程中，执行**BroadcastReceiver.onReceive()**方法已经超过10秒

- **CPU负载**。**Load**关键字表明了最近1分钟、5分钟、15分钟内的CPU负载分别是30.4、22.3、19.94。CPU最近1分钟的负载最具参考价值，因为ANR的超时限制基本都是1分钟以内，
  这可以近似的理解为CPU最近1分钟平均有30.4个任务要处理，这个负载值是比较高的

- **CPU使用统计时间段**。**CPU usage from XX to XX ago**关键字表明了这是在ANR发生之前一段时间内的CPU统计。
  类似的还有**CPU usage from XX to XX after**关键字，表明是ANR发生之后一段时间内的CPU统计

- **各进程的CPU使用率**。我们以com.android.systemui进程的CPU使用率为例，它包含以下信息：

  - 总的CPU使用率: 3.3%，其中systemui进程在用户态的CPU使用率是2.6%，在内核态的使用率是0.7%

  - 缺页次数fault：**8402 minor**表示高速缓存中的缺页次数，**343 major**表示内存的缺页次数。minor可以理解为进程在做内存访问，major可以理解为进程在做IO操作。
    当前minor和major值都是比较高的，从侧面反映了发生ANR之前，systemui进程有有较多的内存访问操作，引发的IO次数也会较多

  - **CPU使用率前面的 “+”**。部分进程的CPU使用率前面有 **“+”** 号，譬如cat和zygote64，表示在上一次CPU统计的时间片段内，还没有这些进程，而这一次CPU统计的时间片段内，运行了这些进程。
    类似的还有 **“-”** 号，表示两次CPU统计时间片段时，这些进程消亡了

- **CPU使用汇总**。**TOTAL**关键字表明了CPU使用的汇总，87%是总的CPU使用率，其中有一项**iowait**表明CPU在等待IO的时间，占到64%，说明发生ANR以前，有大量的IO操作。app_process、
  system_server, com.android.systemui这几个进程的major值都比较大，说明这些进程的IO操作较为频繁，从而拉升了整个**iowait**的时间

信息量是如此的庞大，以致于我们都要下结论了：CPU大量的时间都在等待IO，导致systemui进程分配不到CPU时间，从而主线程处理广播消息超时，发生了ANR。

对于一个严谨的开发人员而言，这种结论下得有点早，因为还有太多的疑问：

- systemui进程也分到了一些CPU时间(3.3%)，难道**BroadcastReceiver.onReceive()**方法就一直无法执行吗？

- 为什么iowait的时间会这么多，而且多个进程的major值都很高？

接下来还是需要从其他日志中还原ANR出现的场景。

## 3.3 场景还原

### 3.3.1 第一个假设和验证

带着上文提出来的第一个疑问，我们先来做一个假设：如果systemui进程正在执行**BroadcatReceiver.onReceive()**方法，那么从traces.txt文件中，应该可以看到主线程的函数调用栈正在执行这个方法。

接下来，我们首先从traces文件中，找到发生ANR时(**00:48:27**)，sysemtui进程的函数调用栈信息。

	----- pid 29533 at 2015-10-16 00:48:06 -----
    Cmd line: com.android.systemui

    DALVIK THREADS (53):
    "main" prio=5 tid=1 Native
      | group="main" sCount=1 dsCount=0 obj=0x75bd5818 self=0x7f8549a000
      | sysTid=29533 nice=0 cgrp=bg_non_interactive sched=0/0 handle=0x7f894bbe58
      | state=S schedstat=( 288625433917 93454573244 903419 ) utm=20570 stm=8292 core=3 HZ=100
      | stack=0x7fdffda000-0x7fdffdc000 stackSize=8MB
      | held mutexes=
      native: #00 pc 00060b0c  /system/lib64/libc.so (__epoll_pwait+8)
      native: #01 pc 0001bb54  /system/lib64/libc.so (epoll_pwait+32)
      native: #02 pc 0001b3d8  /system/lib64/libutils.so (android::Looper::pollInner(int)+144)
      native: #03 pc 0001b75c  /system/lib64/libutils.so (android::Looper::pollOnce(int, int*, int*, void**)+76)
      native: #04 pc 000d7194  /system/lib64/libandroid_runtime.so (android::NativeMessageQueue::pollOnce(_JNIEnv*, int)+48)
      at android.os.MessageQueue.nativePollOnce(Native method)
      at android.os.MessageQueue.next(MessageQueue.java:148)
      at android.os.Looper.loop(Looper.java:151)
      at android.app.ActivityThread.main(ActivityThread.java:5718)
      at java.lang.reflect.Method.invoke!(Native method)
      at java.lang.reflect.Method.invoke(Method.java:372)
      at com.android.internal.os.ZygoteInit$MethodAndArgsCaller.run(ZygoteInit.java:975)
      at com.android.internal.os.ZygoteInit.main(ZygoteInit.java:770)

    ----- pid 29533 at 2015-10-16 00:48:29 -----
    Cmd line: com.android.systemui

    DALVIK THREADS (54):
    "main" prio=5 tid=1 Blocked
      | group="main" sCount=1 dsCount=0 obj=0x75bd5818 self=0x7f8549a000
      | sysTid=29533 nice=0 cgrp=bg_non_interactive sched=0/0 handle=0x7f894bbe58
      | state=S schedstat=( 289080040422 93461978317 904874 ) utm=20599 stm=8309 core=0 HZ=100
      | stack=0x7fdffda000-0x7fdffdc000 stackSize=8MB
      | held mutexes=
      at com.mediatek.anrappmanager.MessageLogger.println(SourceFile:77)
      - waiting to lock <0x26b337a3> (a com.mediatek.anrappmanager.MessageLogger) held by thread 49
      at android.os.Looper.loop(Looper.java:195)
      at android.app.ActivityThread.main(ActivityThread.java:5718)
      at java.lang.reflect.Method.invoke!(Native method)
      at java.lang.reflect.Method.invoke(Method.java:372)
      at com.android.internal.os.ZygoteInit$MethodAndArgsCaller.run(ZygoteInit.java:975)
      at com.android.internal.os.ZygoteInit.main(ZygoteInit.java:770)
    ...
    "Binder_5" prio=5 tid=49 Native
      | group="main" sCount=1 dsCount=0 obj=0x136760a0 self=0x7f7e453000
      | sysTid=6945 nice=0 cgrp=default sched=0/0 handle=0x7f6e3ce000
      | state=S schedstat=( 5505571091 4567508913 30743 ) utm=264 stm=286 core=4 HZ=100
      | stack=0x7f6b83f000-0x7f6b841000 stackSize=1008KB
      | held mutexes=
      native: #00 pc 00019d14  /system/lib64/libc.so (syscall+28)
      native: #01 pc 0005b5d8  /system/lib64/libaoc.so (???)
      native: #02 pc 002c6f18  /system/lib64/libaoc.so (???)
      native: #03 pc 00032c40  /system/lib64/libaoc.so (???)
      at libcore.io.Posix.getpid(Native method)
      at libcore.io.ForwardingOs.getpid(ForwardingOs.java:83)
      at android.system.Os.getpid(Os.java:176)
      at android.os.Process.myPid(Process.java:754)
      at com.mediatek.anrappmanager.MessageLogger.dump(SourceFile:219)
      - locked <0x26b337a3> (a com.mediatek.anrappmanager.MessageLogger)
      at com.mediatek.anrappmanager.ANRAppManager.dumpMessageHistory(SourceFile:65)
      at android.app.ActivityThread$ApplicationThread.dumpMessageHistory(ActivityThread.java:1302)
      at android.app.ApplicationThreadNative.onTransact(ApplicationThreadNative.java:682)
      at android.os.Binder.execTransact(Binder.java:451)

最终，我们找到systemui进程ANR时刻(**00:48:27**)附近的两个函数调用栈:

1. 在ANR发生之前(**00:48:06**)，主线程的函数调用栈处于正常状态：消息队列中，循环中处理消息

2. 在ANR发生之后2秒(**00:48:29**)，主线程处于Blocked状态，在等待一个被49号线程持有的锁。而49号线程是一个Binder线程，anrappmanager正在做dump操作。

> 笔者分析的日志是MTK平台产生的，所以从函数调用栈中看到**com.mediatek.anrappmanager.MessageLogger**这样的类，它是MTK在AOSP上的扩展，用于打印ANR日志。

**至此，systemui进程发生ANR的直接原因我们已经找到了，systemui进程正在打印traces，存在较长时间的IO操作，导致主线程阻塞，从而无法处理TIME_TICK广播消息，所以发生了ANR。**

要避免这种场景下的ANR，我们就需要打破主线程中Blocked的逻辑。其实本例是由于MTK在AOSP的**android.os.Looper.loop()**扩展了打印消息队列的功能，该功能存在设计缺陷，会导致锁等待的情况。

### 3.3.2 第二个假设和验证

我们进一步挖掘在systemui还没有发生ANR时，就在打印traces的原因。带着上文提出的第二个疑问，我们来做另一个假设：
iowait较高，而且多个进程的major都很高，可能是由于当前正在调用**AMS.dumpStackTraces()**方法，很多进程都需要将自己的函数调用栈写到traces文件，所以IO就会较高。
如果当前正在调用**AMS.dumpStackTraces()**方法，那说明当时系统已经发生了异常，要么已经有ANR发生，要么有SNR发生

从`event log`中，我们检索到了另一个ANR：

    10-16 00:47:58 820 907 I am_anr  : [0,10464,com.android.settings,1086864965,Input dispatching timed out (Waiting to send key event because the focused window has not finished processing all of the input events that were previously delivered to it.  Outbound queue length: 0.  Wait queue length: 1.)]

在 **00:47:58** 这个时刻，**com.android.settings**进程发生了ANR，而且ANR的时间在systemui之前(**00:48:27**)。这一下，我们就找到佐证了，正是因为settings进程先发生了ANR，调用**AMS.dumpStackTraces()**，
从而很多进程都开始了打印traces的操作，所以系统的整个iowait比较高，大量进程的major值也比较高，systemui就在其列。在MTK逻辑的影响下，打印ANR日志会导致主线程阻塞，从而就连带引发了其他应用的ANR。

在`system log`中，我们检索到了settings进程ANR的CPU使用信息：

    10-16 00:48:12 820 907 E ActivityManager: ANR in com.android.settings (com.android.settings/.SubSettings), time=130063718
    10-16 00:48:12 820 907 E ActivityManager: Reason: Input dispatching timed out (Waiting to send key event because the focused window has not finished processing all of the input events that were previously delivered to it.  Outbound queue length: 0.  Wait queue length: 1.)
    10-16 00:48:12 820 907 E ActivityManager: Load: 21.37 / 19.25 / 18.84
    10-16 00:48:12 820 907 E ActivityManager: Android time :[2015-10-16 00:48:12.24] [130077,742]
    10-16 00:48:12 820 907 E ActivityManager: CPU usage from 0ms to 7676ms later:
    10-16 00:48:12 820 907 E ActivityManager:   91% 820/system_server: 16% user + 75% kernel / faults: 13192 minor 167 major
    10-16 00:48:12 820 907 E ActivityManager:   3.2% 175/mmcqd/0: 0% user + 3.2% kernel
    10-16 00:48:12 820 907 E ActivityManager:   2.9% 29533/com.android.systemui: 2.3% user + 0.6% kernel / faults: 1352 minor 10 major
    10-16 00:48:12 820 907 E ActivityManager:   2.2% 1736/com.android.phone: 0.9% user + 1.3% kernel / faults: 1225 minor 1 major
    10-16 00:48:12 820 907 E ActivityManager:   2.2% 10464/com.android.settings: 0.7% user + 1.4% kernel / faults: 2801 minor 105 major
    10-16 00:48:12 820 907 E ActivityManager:   0% 1785/com.meizu.experiencedatasync: 0% user + 0% kernel / faults: 3478 minor 2 major
    10-16 00:48:12 820 907 E ActivityManager:   1.8% 11333/com.meizu.media.video: 1% user + 0.7% kernel / faults: 3843 minor 89 major
    10-16 00:48:12 820 907 E ActivityManager:   1.5% 332/mobile_log_d: 0.5% user + 1% kernel / faults: 94 minor 1 major
    10-16 00:48:12 820 907 E ActivityManager:   1% 11306/com.meizu.media.gallery: 0.7% user + 0.2% kernel / faults: 2204 minor 55 major
    ...
    10-16 00:48:12 820 907 E ActivityManager:  +0% 11397/sh: 0% user + 0% kernel
    10-16 00:48:12 820 907 E ActivityManager:  +0% 11398/app_process: 0% user + 0% kernel
    10-16 00:48:12 820 907 E ActivityManager: 29% TOTAL: 5.1% user + 15% kernel + 9.5% iowait + 0% softirq

具体的涵义我们不再赘述了，只关注一下ANR的原因:

> Input dispatching timed out (Waiting to send key event because the focused window has not finished processing all of the input events that were previously delivered to it.<br/>
> **Outbound queue length: 0.  Wait queue length: 1.**)

之前对Input ANR机制的分析派上用长了，我们轻松知道这种ANR的原因是什么。
`Wait queue length： 1`表示之前的输入事件已经派发到Settings进程了，但Settings进程还没有处理完毕，新来的KeyEvent事件已经等待超过了5秒，所以ANR产生了。

接下来，又需要找到Settings的traces，分析Settings主线程处理输入事件超时的原因，我们点到为止。

# 4. 总结

本文对Android ANR机制进行了深入的分析：

- **ANR的监测机制**，从Service，Broadcast，InputEvent三种不同的ANR监测机制的源码实现开始，分析了Android如何发现各类ANR。在启动服务、派发广播消息和输入事件时，植入超时检测，用于发现ANR

- **ANR的报告机制**，分析Android如何输出ANR日志。当ANR被发现后，两个很重要的日志输出是：CPU使用情况和进程的函数调用栈，这两类日志是我们解决ANR问题的利器

- **ANR的解决方法**，通过一个案例，对ANR日志进行了深入解读，梳理了分析ANR问题的思路和途径

最后，致各位读者，从日志出发解决ANR问题，理解ANR机制背后的实现原理，碰到再难的ANR问题也无需惊慌。