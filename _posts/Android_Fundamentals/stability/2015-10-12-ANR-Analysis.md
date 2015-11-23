---
layout: post
category: Android系统原理
title: ANR机制以及问题分析
tagline:
tags:  [Android调试]
---
{% include JB/setup %}

# 1. 概览



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

Service运行在应用程序的主线程，如果Service的执行时间超过20秒，则会引发ANR。
当发生**Service ANR**时，一般可以先排查一下在Service的生命周期函数中(onCreate(), onStartCommand()等)有没有做耗时的操作，譬如复杂的运算、IO操作等。
如果应用程序的代码逻辑查不出问题，就需要深入检查当前系统的状态：CPU的使用情况、系统服务的状态等，判断当时系统的运行状态是否对ANR进程有影响。

如何检测Service超时呢？Android是通过设置定时消息实现的。定时消息是由AMS的消息队列处理的(system_server的ActivityManager线程)。
AMS有Sercie运行的上下文信息，所以在AMS中设置一套超时检测机制也是合情合理的。

Service ANR机制相对最为简单，主体实现在[ActiveServices](https://android.googlesource.com/platform/frameworks/base/+/master/services/core/java/com/android/server/am/ActiveServices.java)中，
有几个关键点：

- 当Service的生命周期开始时，**bumpServiceExecutingLocked()**会被调用，紧接着会调用**scheduleServiceTimeoutLocked()**，
  通过AMS.MainHandler抛出一个定时消息**SERVICE_TIMEOUT_MSG**，前台进程中执行Service，超时时间是**SERVICE_TIMEOUT(20秒)**;
  后台进程中执行Service，超时时间是**SERVICE_BACKGROUND_TIMEOUT(200秒)**

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


- 当Service的生命周期结束时，**serviceDoneExecutingLocked()**会被调用，之前抛出的**SERVICE_TIMEOUT_MSG**消息会被清除

- 如果在超时时间内，**SERVICE_TIMEOUT_MSG**没有被清除，那么，AMS.MainHandler就会响应这个消息:

{% highlight java %}
case SERVICE_TIMEOUT_MSG: {
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

- 如果不是在做dexopt操作，**ActiveServices.serviceTimeout()**就会被调用，它会找到当前进程已经超时的Service，经过一些判定后，决定要报告ANR，最终调用**AMS.appNotResponding()**方法。

{% highlight java %}
void serviceTimeout(ProcessRecord proc) {
    ...
    final long maxTime =  now -
              (proc.execServicesFg ? SERVICE_TIMEOUT : SERVICE_BACKGROUND_TIMEOUT);
    ...
    for (int i=proc.executingServices.size()-1; i>=0; i--) {
        ServiceRecord sr = proc.executingServices.valueAt(i);
        if (sr.executingStart < maxTime) {
            timeout = sr;
            break;
        }
       ...
    }
    ...
    if (timeout != null && mAm.mLruProcesses.contains(proc)) {
        anrMessage = "executing service " + timeout.shortName;
    }
    ...
    if (anrMessage != null) {
        mAm.appNotResponding(proc, null, null, false, anrMessage);
    }
}
{% endhighlight %}

当调用**AMS.appNotResponding()**这个方法时，ANR机制已经完成了监测报告任务，剩下的任务就是ANR结果的输出，都是由这个方法的实现，我们后文再详细展开。

**至此，我们分析了Service的ANR机制：**

**通过定时消息跟踪Service的运行，定时消息被响应就意味着Service运行超时了，此时，就报告ANR。**

### 2.1.2 Broadcast处理超时

应用程序可以注册广播接收器，实现**BroadcastReceiver.onReceive()**方法来完成对广播的处理。
通常，这个方法是在主线程执行的，Android限定它执行时间不能超过**10秒**，否则，就会引发ANR。

**onReceive()**也可以调度在其他线程执行，通过**Context.registerReceiver(BroadcastReceiver, IntentFilter, String, Handler)**这个方法注册广播接收器，
可以指定一个处理的Handler，将**onReceive()**调度在非主线程执行。

**这里先把问题抛出来了：**

> 1. Android如何将广播投递给各个应用程序？
> 2. Android如何检测广播处理超时？
> 3. 在什么场景下，系统会导致**onReceive()**方法超时？

AMS维护了两个广播队列[BroadcastQueue](https://android.googlesource.com/platform/frameworks/base/+/master/services/core/java/com/android/server/am/BroadcastQueue.java): 
**foreground queue**和**background queue**，之所以有两个，就是因为要区分的不同超时时间：
前台队列的超时时间是10秒，后台队列的超时时间是60秒。所有发送的广播都会进入到队列中等待调度，可以通过**Intent.FLAG_RECEIVER_FOREGROUND**参数将广播投递到前台队列。

**BroadcastQueue.scheduleBroadcastsLocked()**完成对广播的调度，其实是往AMS线程(system_server进程中的ActivityManager线程)的消息队列发送**BROADCAST_INTENT_MSG**消息，
经过一轮消息处理，真正执行广播调度的是**BroadcastQueue.processNextBroadcast()**，广播超时监测机制的调用关系如下：

    BroadcastQueue.processNextBroadcast()
    └── BroadcastQueue.broadcastTimeoutLocked()
    │   └── BroadcastQueue.AppNotResponding.run()
    │       └── AMS.appNotResponding()
    │
    └── BroadcastQueue.setBroadcastTimeoutLocked()
        └── BroadcastQueue.broadcastTimeoutLocked()
            └── BroadcastQueue.AppNotResponding.run()
                └── AMS.appNotResponding()

{% highlight java %}
final void  processNextBroadcast(boolean fromMsg) {
    ...
    r = mOrderedBroadcasts.get(0);
    if ((numReceivers > 0) && (now > r.dispatchTime + (2*mTimeoutPeriod*numReceivers))) {
        ...
        broadcastTimeoutLocked(false); // forcibly finish this broadcast
        ...
    }
    ...

    if (! mPendingBroadcastTimeoutMessage) {
        long timeoutTime = r.receiverTime + mTimeoutPeriod;
        ...
        setBroadcastTimeoutLocked(timeoutTime);
    }
}

final void setBroadcastTimeoutLocked(long timeoutTime) {
    if (! mPendingBroadcastTimeoutMessage) {
        Message msg = mHandler.obtainMessage(BROADCAST_TIMEOUT_MSG, this);
        mHandler.sendMessageAtTime(msg, timeoutTime);
        mPendingBroadcastTimeoutMessage = true;
    }
}

{% endhighlight %}

- 第一个监测机制为判定当前时间是否已经超过了 r.dispatchTime + 2*mTimeoutPeriod*numReceivers

  - dispatchTime表示这一系列广播开始派发的时间
  - mTimeoutPeriod由当前BroadcastQueue的类型决定(forground为10秒，background为60秒)
  - numReceivers表示当前接收该广播的Receiver数量

- 第二个监测机制是设置定时消息：
  
  - receiverTime表示当前广播被Receiver接收的时间，
  - 通过setBroadcastTimeoutLocked()设置一个定时消息，消息抛出的时间为 r.receiverTime + mTimeoutPeriod
  - 与Service ANR类似，定时消息**BROADCAST_TIMEOUT_MSG**也是抛到AMS的消息队列
  - **BROADCAST_TIMEOUT_MSG**的消息响应其实还是调用broadcastTimeoutLocked()方法

### 2.1.3 Input处理超时

应用程序可以接收输入事件(按键、触屏、轨迹球等)，当5秒内没有处理完毕时，则会引发ANR。

**如果Broadcast ANR一样，我们抛出Input ANR的几个问题：**

> 1. 输入事件经历了一些什么工序才能被派发到应用的界面？
> 2. 如何检测到输入时间处理超时？
> 3. 在什么场景下，会导致**InputEvent**超时？

输入事件最开始由硬件设备(譬如按键或触摸屏幕)发起，Android有一套输入子系统来发现各种输入事件，这些事件最终都会被[InputDispatcher](https://android.googlesource.com/platform/frameworks/native/+/master/services/inputflinger/InputDispatcher.cpp)分发到各个需要接收事件的窗口。
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

每注册一个InputChannel都被视为一个Connection，通过文件描述符来区别。InputDispatcher是一个消息处理循环，当有新的Connection时，就需要唤醒消息循环队列进行处理。

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

具体每个函数的实现逻辑此处不表。我们提出来几个关键点：

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

- 首先，会调用**findFocusedWindowTargetsLocked()**或**findTouchedWindowTargetsLocked()**寻找接收输入事件的窗口，

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

  - 如果当前事件派发已经超时，则说明已经检测到了ANR，调用**onANRLocked()**方法
  - 如果当前没有超时，则继续调度。

- 最后，在[**onANRLocked()**](https://android.googlesource.com/platform/frameworks/native/+/master/services/inputflinger/InputDispatcher.cpp#3430)方法中，
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
    // 3. 发生ANR的进程是测试进程，需要中断，但不在UI界面显示ANR信息
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

ANR监测机制小结

## 2.2 ANR的报告机制

无论哪种类型的ANR发生以后，最终都会调用 *AMS.appNotResponding()* 方法，所谓“殊途同归”。这个方法的职能就是向用户或开发者报告ANR发生了。
最终的表现形式是：弹出一个对话框，告诉用户当前某个程序无响应;输入一大堆与ANR相关的日志，便于开发者解决问题。

最终形式我们见过很多，但输出日志的原理是什么，未必所有人都了解。下面我们就来见识一下是如何输出ANR日志的。

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