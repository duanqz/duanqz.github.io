---
layout: post
category: Android系统原理
title: Watchdog机制以及问题分析
tagline:
tags:  [Android调试]
---
{% include JB/setup %}

# 1. 概览

`Watchdog`的中文的“看门狗”，有保护的意思。最早引入Watchdog是在单片机系统中，由于单片机的工作环境容易受到外界磁场的干扰，导致程序“跑飞”，造成整个系统无法正常工作，因此，引入了一个“看门狗”，对单片机的运行状态进行实时监测，针对运行故障做一些保护处理，譬如让系统重启。这种Watchdog属于硬件层面，必须有硬件电路的支持。

Linux也引入了Watchdog，在Linux内核下，当Watchdog启动后，便设定了一个定时器，如果在超时时间内没有对/dev/Watchdog进行写操作，则会导致系统重启。通过定时器实现的Watchdog属于软件层面。

Android设计了一个软件层面Watchdog，用于保护一些重要的系统服务，当出现故障时，通常会让Android系统重启。由于这种机制的存在，就经常会出现一些system_server进程被Watchdog杀掉而发生手机重启的问题。

本文期望回答以下问题：

> 1. Watchdog是怎么工作的？这涉及到Watchdog的工作机制。<br/>
> 2. 遇到Watchdog的问题该怎么办？这涉及到分析Watchdog问题的惯用方法。

# 2. Watchdog机制

我们以[frameworks/base/services/core/java/com/android/server/Watchdog.java]({{ site.android_source }}/platform/frameworks/base/+/master/services/core/java/com/android/server/Watchdog.java)为蓝本，分析Watchdog的实现逻辑。为了描述方便，ActivityManagerService， PackageManagerService， WindowManagerService会分别简称为AMS, PKMS, WMS。

## 2.1 Watchdog的初始化

Android的Watchdog是一个单例线程，在System Server时就会初始化Watchdog。Watchdog在初始化时，会构建很多**HandlerChecker**，大致可以分为两类：

- **Monitor Checker**，用于检查是Monitor对象可能发生的死锁, AMS, PKMS, WMS等核心的系统服务都是Monitor对象。

- **Looper Checker**，用于检查线程的消息队列是否长时间处于工作状态。Watchdog自身的消息队列，Ui, Io, Display这些全局的消息队列都是被检查的对象。此外，一些重要的线程的消息队列，也会加入到**Looper Checker**中，譬如AMS, PKMS，这些是在对应的对象初始化时加入的。

{% highlight java %}
private Watchdog() {
    ....
    mMonitorChecker = new HandlerChecker(FgThread.getHandler(),
                "foreground thread", DEFAULT_TIMEOUT);
    mHandlerCheckers.add(mMonitorChecker);
    mHandlerCheckers.add(new HandlerChecker(new Handler(Looper.getMainLooper()),
                "main thread", DEFAULT_TIMEOUT));
    mHandlerCheckers.add(new HandlerChecker(UiThread.getHandler(),
                "ui thread", DEFAULT_TIMEOUT));
    mHandlerCheckers.add(new HandlerChecker(IoThread.getHandler(),
                "i/o thread", DEFAULT_TIMEOUT));
    mHandlerCheckers.add(new HandlerChecker(DisplayThread.getHandler(),
                "display thread", DEFAULT_TIMEOUT));
    ...
}
{% endhighlight %}

两类**HandlerChecker**的侧重点不同，**Monitor Checker**预警我们不能长时间持有核心系统服务的对象锁，否则会阻塞很多函数的运行; 
**Looper Checker**预警我们不能长时间的霸占消息队列，否则其他消息将得不到处理。这两类都会导致系统卡住(System Not Responding)。

## 2.2 添加Watchdog监测对象

Watchdog初始化以后，就可以作为system_server进程中的一个单独的线程运行了。但这个时候，还不能触发Watchdog的运行，因为AMS, PKMS等系统服务还没有加入到Watchdog的监测集。
所谓监测集，就是需要Watchdog关注的对象，Android中有成千上万的消息队列在同时运行，然而，Watchdog毕竟是系统层面的东西，它只会关注一些核心的系统服务。

Watchdog提供两个方法，分别用于添加**Monitor Checker**对象和**Looper Checker**对象:

{% highlight java %}
public void addMonitor(Monitor monitor) {
    // 将monitor对象添加到Monitor Checker中，
    // 在Watchdog初始化时，可以看到Monitor Checker本身也是一个HandlerChecker对象
    mMonitors.add(monitor);
}

public void addThread(Handler thread, long timeoutMillis) {
    synchronized (this) {
        if (isAlive()) {
            throw new RuntimeException("Threads can't be added once the Watchdog is running");
        }
        final String name = thread.getLooper().getThread().getName();
        // 为Handler构建一个HandlerChecker对象，其实就是**Looper Checker**
        mHandlerCheckers.add(new HandlerChecker(thread, name, timeoutMillis));
    }
}
{% endhighlight %}

被Watchdog监测的对象，都需要将自己添加到Watchdog的监测集中。以下是AMS的类定义和构造器的代码片段：

{% highlight java %}
public final class ActivityManagerService extends ActivityManagerNative
        implements Watchdog.Monitor, BatteryStatsImpl.BatteryCallback {

    public ActivityManagerService(Context systemContext) {
        ...
        Watchdog.getInstance().addMonitor(this);
        Watchdog.getInstance().addThread(mHandler);
    }

    public void monitor() {
        synchronized (this) { }
    }
}
{% endhighlight %}

AMS实现了Watchdog.Monitor接口，这个接口只有一个方法，就是monitor()，它的作用后文会再解释。这里可以看到在AMS的构造器中，将自己添加到**Monitor Checker**对象中，然后将自己的handler添加到**Looper Checker**对象中。
其他重要的系统服务添加到Watchdog的代码逻辑都与AMS差不多。

整个Android系统中，被monitor的对象并不多，十个手指头就能数出来Watchdog.Monitor的实现类的个数。

## 2.3 Watchdog的监测机制

Watchdog本身是一个线程，它的run()方法实现如下：

{% highlight java %}
@Override
public void run() {
    boolean waitedHalf = false;
    while (true) {
        ...
        synchronized (this) {
            ...
            // 1. 调度所有的HandlerChecker
            for (int i=0; i<mHandlerCheckers.size(); i++) {
                HandlerChecker hc = mHandlerCheckers.get(i);
                hc.scheduleCheckLocked();
            }
            ...
            // 2. 开始定期检查
            long start = SystemClock.uptimeMillis();
            while (timeout > 0) {
                ...
                try {
                    wait(timeout);
                } catch (InterruptedException e) {
                    Log.wtf(TAG, e);
                }
                ...
                timeout = CHECK_INTERVAL - (SystemClock.uptimeMillis() - start);
            }

            // 3. 检查HandlerChecker的完成状态
            final int waitState = evaluateCheckerCompletionLocked();
            if (waitState == COMPLETED) {
                ...
                continue;
            } else if (waitState == WAITING) {
                ...
                continue;
            } else if (waitState == WAITED_HALF) {
                ...
                continue;
            }

            // 4. 存在超时的HandlerChecker
            blockedCheckers = getBlockedCheckersLocked();
            subject = describeCheckersLocked(blockedCheckers);
            allowRestart = mAllowRestart;
        }
        ...
        // 5. 保存日志，判断是否需要杀掉系统进程
        Slog.w(TAG, "*** GOODBYE!");
        Process.killProcess(Process.myPid());
        System.exit(10);
    } // end of while (true)

}
{% endhighlight %}

以上代码片段主要的运行逻辑如下：

1. Watchdog运行后，便开始无限循环，依次调用每一个HandlerChecker的scheduleCheckLocked()方法
2. 调度完HandlerChecker之后，便开始定期检查是否超时，每一次检查的间隔时间由**CHECK_INTERVAL**常量设定，为30秒
3. 每一次检查都会调用evaluateCheckerCompletionLocked()方法来评估一下HandlerChecker的完成状态：
  - COMPLETED表示已经完成
  - WAITING和WAITED_HALF表示还在等待，但未超时
  - OVERDUE表示已经超时。默认情况下，timeout是1分钟，但监测对象可以通过传参自行设定，譬如PKMS的**Handler Checker**的超时是10分钟
4. 如果超时时间到了，还有HandlerChecker处于未完成的状态(OVERDUE)，则通过getBlockedCheckersLocked()方法，获取阻塞的HandlerChecker，生成一些描述信息
5. 保存日志，包括一些运行时的堆栈信息，这些日志是我们解决Watchdog问题的重要依据。如果判断需要杀掉system_server进程，则给当前进程(system_server)发送signal 9

只要Watchdog没有发现超时的任务，HandlerChecker就会被不停的调度，那HandlerChecker具体做一些什么检查呢？ 直接上代码：

{% highlight java %}
public final class HandlerChecker implements Runnable {

    public void scheduleCheckLocked() {
        // Looper Checker中是不包含monitor对象的，判断消息队列是否处于空闲
        if (mMonitors.size() == 0 && mHandler.getLooper().isIdling()) {
            mCompleted = true;
            return;
        }
        ...
        // 将Monitor Checker的对象置于消息队列之前，优先运行
        mHandler.postAtFrontOfQueue(this);
    }

    @Override
    public void run() {
        // 依次调用Monitor对象的monitor()方法
        for (int i = 0 ; i < size ; i++) {
            synchronized (Watchdog.this) {
                mCurrentMonitor = mMonitors.get(i);
            }
            mCurrentMonitor.monitor();
        }
        ...
    }
}
{% endhighlight %}

- 对于**Looper Checker**而言，会判断线程的消息队列是否处于空闲状态。
  如果被监测的消息队列一直闲不下来，则说明可能已经阻塞等待了很长时间

- 对于**Monitor Checker**而言，会调用实现类的monitor方法，譬如上文中提到的AMS.monitor()方法，
  方法实现一般很简单，就是获取当前类的对象锁，如果当前对象锁已经被持有，则monitor()会一直处于wait状态，直到超时，这种情况下，很可能是线程发生了死锁



**至此，我们已经分析了Watchdog的工作机制，回答了我们提出的第一个问题：**

**Watchdog定时检查一些重要的系统服务，举报长时间阻塞的事件，甚至杀掉system_server进程，让Android系统重启。**

# 3. 问题分析方法

## 3.1 日志获取

Andriod的日志门类繁多，而且，为了调试的需要，设备厂商和应用开发者都会在AOSP的基础上增加很多日志。
面对如此庞大复杂的日志系统，通常只有对应领域的专家才能看懂其透露的细节信息，就像去医院就诊，医生一看检查报告就知道患者身体出了什么问题，而外行对这些诊断信息往往是束手无策的。

解决Watchdog相关的问题，对日志的要求比较高，有些问题与当时的系统环境相关，仅仅凭借单一的日志并不能定位问题。
以下罗列出获取Android日志的一些重要手段，部分场景下，Watchdog相关的问题甚至需要以下所有的日志：

- **logcat** 通过`adb logcat`命令输出Android的一些当前运行日志，可以通过logcat的 **-b** 参数指定要输出的日志缓冲区，缓冲区对应着logcat的一种日志类型。
  高版本的logcat可以使用 **-b all** 获取到所有缓冲区的日志

  - *event* 通过android.util.EventLog工具类打印的日志，一些重要的系统事件会使用此类日志
  - *main* 通过android.util.Log工具类打印的日志，应用程序，尤其是基于SDK的应用程序，会使用此类日志
  - *system* 通过android.util.Slog工具类打印的日志，系统相关的日志一般都是使用此类日志，譬如SystemServer
  - *radio* 通过android.util.Rlog工具类打印的日志，通信模块相关的日志一般都是使用此类日志，譬如RIL

- **dumpsys** 通过`adb dumpsys`命令输出一些重要的系统服务信息，譬如内存、电源、磁盘等，
  工作原理可以查阅[dumpsys介绍](/2015-07-19-Intro-to-dumpsys)一文

- **traces** 该文件记录了一个时间段的函数调用栈信息，通常在应用发生ANR(Application Not Responding)时，会触发打印各进程的函数调用栈。
  站在Linux的角度，其实就是向进程发送SIGNAL_QUIT(3)请求，譬如，我们可以通过`adb shell kill -3 <pid>`命令，打印指定进程<pid>的的trace。
  SIGNAL_QUIT(3)表面意思有一点误导，它其实并不会导致进程退出。输出一般在 */data/anr/traces.txt* 文件中，当然，这是可以灵活配置的，
  Android提供的系统属性dalvik.vm.stack-trace-file可以用来配置生成traces文件的位置。

- **binder** 通过Binder跨进程调用的日志，可以通过`adb shell cat`命令从 */proc/binder* 下取出对应的日志

  - failed_transaction_log
  - transaction_log
  - transactions
  - stats

- **dropbox** 为了记录历史的logcat日志，Android引入了Dropbox，将历史日志持久化到磁盘中(**/data/system/dropbox**)。
  logcat的缓冲区大小毕竟是有限的，所以需要循环利用，这样历史的日志信息就会被冲掉。在一些自动化测试的场景下，譬如Monkey需要长时间的运行，
  就需要把历史的日志全都保存下来。

- **tombstone** tombstone错误一般由Dalvik错误、native层的代码问题导致的。当系统发生tombstone时，内核会上报一个严重的警告信号，
  上层收到后，把当前的调用栈信息持久化到磁盘中(**/data/tombstone**)

- **bugreport** 通过`adb bugreport`命令输出，日志内容多到爆，logcat, traces, dmesg, dumpsys, binder的日志都包含在其中。
  由于输出bugreport的时间很长，当系统发生错误时，我们再执行bugreport往往就来不及了(此时，系统可能都已经重启了)，所以，要动用bugreport就需要结合一些其他机制，
  譬如在杀掉system_server进程之前，先让bugreport运行完。

## 3.2 问题定位

Watchdog出现的日志很明显，logcat中的event, system中都会有体现，要定位问题，可以从检索日志中的watchdog关键字开始。

发生Watchdog检测超时这么重要的系统事件，Android会打印一个EventLog：

    watchdog: Blocked in handler XXX    # 表示HandlerChecker超时了
    watchdog: Blocked in monitor XXX    # 表示MonitorChecker超时了

Watchdog是运行在system_server进程中，会打印一些System类型的日志。在手机处于非调试状态时，伴随Watchdog出现的往往是system_server进程被杀，从而系统重启。
当Watchdog要主动杀掉system_server进程时，以下关键字就会出现在SystemLog中：

    Watchdog: *** WATCHDOG KILLING SYSTEM PROCESS: XXX
    Watchdog: XXX
    Watchdog: "*** GOODBYE!

当我们在日志中检索到上述两类关键信息时，说明“Watchdog显灵”了，从另一个角度来理解，就是“System Not Responding”了。
接下来，我们需要进一步定位在watchdog出现之前，system_server进程在干什么，处于一个什么状态。
这与排除”Application Not Responding“问题差不多，我们需要进程的traces信息、当前系统的CPU运行信息、IO信息。

找到Watchddog出现之前的traces.txt文件，这个时间差最好不要太大，因为Watchdog默认的超时时间是1分钟，太久以前的traces并不能说明问题。
诱导Watchdong出现的直接原因其实就是system_server中某个线程被阻塞了，这个信息在event和system的log中清晰可见。
我们以一个systemLog为例：

    W Watchdog: *** WATCHDOG KILLING SYSTEM PROCESS: Blocked in monitor com.android.server.wm.WindowManagerService on foreground thread (android.fg)

Watchdog告诉我们**Monitor Checker**超时了，具体在哪呢？ 名为**android.fg**的线程在WindowManagerService的monitor()方法被阻塞了。这里隐含了两层意思：

1. WindowManagerService实现了Watchdog.Monitor这个接口，并将自己作为**Monitor Checker**的对象加入到了Watchdog的监测集中

2. monitor()方法是运行在**android.fg**线程中的。Android将**android.fg**设计为一个全局共享的线程，意味着它的消息队列可以被其他线程共享， 
   Watchdog的**Monitor Checker**就是使用的**android.fg**线程的消息队列。因此，出现**Monitor Checker**的超时，肯定是**android.fg**线程阻塞在monitor()方法上。

我们打开system_server进程的traces，检索 **android.fg** 可以快速定位到该线程的函数调用栈：

    "android.fg" prio=5 tid=25 Blocked
      | group="main" sCount=1 dsCount=0 obj=0x12eef900 self=0x7f7a8b1000
      | sysTid=973 nice=0 cgrp=default sched=0/0 handle=0x7f644e9000
      | state=S schedstat=( 3181688530 2206454929 8991 ) utm=251 stm=67 core=1 HZ=100
      | stack=0x7f643e7000-0x7f643e9000 stackSize=1036KB
      | held mutexes=
      at com.android.server.wm.WindowManagerService.monitor(WindowManagerService.java:13125)
      - waiting to lock <0x126dccb8> (a java.util.HashMap) held by thread 91
      at com.android.server.Watchdog$HandlerChecker.run(Watchdog.java:204)
      at android.os.Handler.handleCallback(Handler.java:815)
      at android.os.Handler.dispatchMessage(Handler.java:104)
      at android.os.Looper.loop(Looper.java:194)
      at android.os.HandlerThread.run(HandlerThread.java:61)
      at com.android.server.ServiceThread.run(ServiceThread.java:46)

**android.fg**线程调用栈告诉我们几个关键的信息：

- 这个线程当前的状态是**Blocked**，阻塞
- 由Watchdog发起调用monitor()，这是一个Watchdog检查，阻塞已经超时
- **waiting to lock <0x126dccb8>**： 阻塞的原因是monitor()方法中在等锁<0x126dccb8>
- **held by thread 91**： 这个锁被编号为91的线程持有，需要进一步观察91号线程的状态。

> 题外话：每一个进程都会对自己所辖的线程编号，从1开始。1号线程通常就是我们所说的主线程。
> 线程在Linux系统中还有一个全局的编号，由sysTid表示。我们在logcat等日志中看到的一般是线程的全局编号。
> 譬如，本例中android.fg线程在system_server进程中的编号是25，系统全局编号是973。

可以在traces.txt文件中检索 *tid=91* 来快速找到91号线程的函数调用栈信息：

    "Binder_C" prio=5 tid=91 Native
      | group="main" sCount=1 dsCount=0 obj=0x12e540a0 self=0x7f63289000
      | sysTid=1736 nice=0 cgrp=default sched=0/0 handle=0x7f6127c000
      | state=S schedstat=( 96931835222 49673449591 260122 ) utm=7046 stm=2647 core=2 HZ=100
      | stack=0x7f5ffbc000-0x7f5ffbe000 stackSize=1008KB
      | held mutexes=
      at libcore.io.Posix.writeBytes(Native method)
      at libcore.io.Posix.write(Posix.java:258)
      at libcore.io.BlockGuardOs.write(BlockGuardOs.java:313)
      at libcore.io.IoBridge.write(IoBridge.java:537)
      at java.io.FileOutputStream.write(FileOutputStream.java:186)
      at com.android.internal.util.FastPrintWriter.flushBytesLocked(FastPrintWriter.java:334)
      at com.android.internal.util.FastPrintWriter.flushLocked(FastPrintWriter.java:355)
      at com.android.internal.util.FastPrintWriter.appendLocked(FastPrintWriter.java:303)
      at com.android.internal.util.FastPrintWriter.print(FastPrintWriter.java:466)
      - locked <@addr=0x134c4910> (a com.android.internal.util.FastPrintWriter$DummyWriter)
      at com.android.server.wm.WindowState.dump(WindowState.java:1510)
      at com.android.server.wm.WindowManagerService.dumpWindowsNoHeaderLocked(WindowManagerService.java:12279)
      at com.android.server.wm.WindowManagerService.dumpWindowsLocked(WindowManagerService.java:12266)
      at com.android.server.wm.WindowManagerService.dump(WindowManagerService.java:12654)
      - locked <0x126dccb8> (a java.util.HashMap)
      at android.os.Binder.dump(Binder.java:324)
      at android.os.Binder.onTransact(Binder.java:290)

91号线程的名字是**Binder_C**，它的函数调用栈告诉我们几个关键信息：

- Native，表示线程处于运行状态(RUNNING)，并且正在执行JNI方法
- 在WindowManagerService.dump()方法申请了锁<0x126dccb8>，这个锁正是**android.fg**线程所等待的
- FileOutputStream.write()表示**Binder_C**线程在执行IO写操作，正式因为这个写操作一直在阻塞，导致线程持有的锁不能释放

> 题外话：关于Binder线程。当Android进程启动时，就会创建一个线程池，专门处理Binder事务。线程池中会根据当前的binder线程计数器的值来构造新创建的binder线程,
> 线程名"Binder_%X"，X是十六进制。当然，线程池的线程数也有上限，默认情况下为16，所以，可以看到 Binder_1 ~ Binder_F 这样的线程命名。

聪明的你看到这或许已经能够想到解决办法了，在这个IO写操作上加一个超时机制，并且这个超时小于Watchdog的超时，不就可以让线程释放它所占有的锁了吗？
是的，这确实可以作为一个临时解决方案(Workaround)，或者说一个保护机制。但我们可以再往深处想一想，这个IO写操作为什么会阻塞：

- 是不是IO缓冲区满了，导致写阻塞呢？
- 是不是写操作有什么锁，导致这个write方法在等锁呢？
- 是不是当前系统的IO负载过于高，导致写操作效率很低呢？

这都需要我们再进一步从日志中去找原因。如果已有的日志不全，找不到论据，我们还需要设计场景来验证假设，解决问题的难度陡然上升。

## 3.3 场景还原

我们经历了两个关键步骤：

1. 通过event或system类型的日志，发现了Watchdog杀掉system_server导致系统重启
2. 通过traces日志，发了导致Watchdog出现的具体线程操作

这两个过程基本就涵盖了Watchdog的运行机制了，但这并没有解决问题啊。我们需要找到线程阻塞的原因是什么，然而，线程阻塞的原因就千奇百怪了。
如果有问题出现的现场，并且问题可以重现，那么我们可以通过调试的手段来分析问题产生的原因。
如果问题只是偶然出现，甚至只有一堆日志，我们就需要从日志中来还原问题出现的场景，这一步才是真正考验大家Android/Linux功底的地方。

继续以上述问题为例，我们来进一步还原问题出现的场景，从Java层的函数调用栈来看：

- 首先，跨进程发起了Binder.dump()方法的调用：at android.os.Binder.dump(Binder.java:324)
- 然后，进入了WMS的dump()：at com.android.server.wm.WindowManagerService.dump(WindowManagerService.java:12654)
- 接着，发生了写文件操作：at java.io.FileOutputStream.write(FileOutputStream.java:186)
- 最后，调用了JNI方法：at libcore.io.Posix.writeBytes(Native method)

**Binder_C**线程要出现这种函数调用栈，我们可以初步确定是Android接受了如下命令
(dumpsys原理请查阅[dumpsys介绍](/2015-07-19-Intro-to-dumpsys)一文)：

{% highlight console %}
$ adb shell dumpsys window
{% endhighlight %}

当通过命令行运行以上命令时，客户端(PC)的adb server会向服务端(手机)的adbd发送指令，
adbd进程会fork出一个叫做dumpsys的子进程，dumpsys进程再利用Binder机制和system_server通信
(adb的实现原理可以查阅[adb介绍](/2015-05-21-Intro-adb)一文)。

仅凭这个还是分析不出问题所在，我们需要启用内核的日志了。当调用JNI方法libcore.io.Posix.writeBytes()时，会触发系统调用，
Linux会从用户态切换到内核态，内核的函数调用栈也可以从traces中找到：

    kernel: __switch_to+0x74/0x8c
    kernel: pipe_wait+0x60/0x9c
    kernel: pipe_write+0x278/0x5cc
    kernel: do_sync_write+0x90/0xcc
    kernel: vfs_write+0xa4/0x194
    kernel: SyS_write+0x40/0x8c
    kernel: cpu_switch_to+0x48/0x4c

在Java层，明确指明要写文件(FileOutputStream)，正常情况下，系统调用write()就完事了，但Kernel却打开了一个管道，最终阻塞在了pipe_wait()方法。
什么场景下会打开一个管道，而且管道会阻塞呢？一系列的猜想和验证过程接踵而至。

这里有必要先补充一些基础知识了：

- **[Linux进程间通信之管道(pipe)](http://www.cnblogs.com/biyeymyhjob/archive/2012/11/03/2751593.html)**

  Linux的管道实现借助了文件系统的file结构和VFS(Virtual File System)，通过将两个file结构指向同一个临时的VFS索引节点，而这个VFS索引节点又指向一个物理页面时，
  实际上就建立了一个管道。

  这就解释了为什么发起系统调用write的时候，打开了一个管道。因为dumpsys和system_server进程，将自己的file结构指向了同一个VFS索引节点。

- **[管道挂起的案例](http://blog.csdn.net/sj13051180/article/details/47865803)**

  管道是一个生产者-消费者模型，当缓冲区满时，则生产者不能往管道中再写数据了，需等到消费者读数据。如果消费者来不及处理缓冲区的数据，或者锁定缓冲区，则生产者就挂起了。
  
  结合到例子中的场景，system_server进程无法往管道中写数据，很可能是dumpsys进程一直忙碌来不及处理新的数据。
  
接下来，需要再从日志中寻找dumpsys进程的运行状态了：

- 是不是dumpsys进程的负载太高？
- 是不是dumpsys进程死掉了，导致一直没有处理缓冲区数据？
- 是不是dumpsys进程有死锁？

接下来的分析过程已经偏离Watchdog机制越来越远了，我们点到为止。

小伙伴们可以看到，场景还原涉及到的知识点非常之宽泛，而且有一定的深度。在没有现场的情况下，伴随一系列的假设和验证过程，充满了不确定性和发现问题的喜悦。
正所谓，同问题做斗争，其乐无穷！

**至此，我们分析Watchdog问题的惯用方法，回答前面提出来的第二个问题：**

**通过event或system类型的logcat日志，检索Watchdog出现的关键信息；通过traces，分析出导致Watchdog检查超时的直接原因；通过其他日志，还原出问题出现的场景。**

# 4. 实例分析

在上面介绍Watchdog问题分析方法的时候，我们其实已经举了一个例子。通常，比较容易定位导致Watchdog出现的直接原因(Direct Cause)，但很难找到更深层次的原因(Root Cause)。
这个小节，我们再介绍一个实例，来分析Watchdog出现的另一种场景。诚然，仅凭几个例子，远不够涵盖Watchdog的所有问题，我们的章法还是按照一定的方法论来深究问题。

回顾一下解决问题三部曲：

1. 日志获取。日志种类繁多，分析Watchdog问题，宁滥毋缺

2. 问题定位。从logcat中锁定watchdog的出现，从traces锁定直接原因

3. 场景还原。结合各类日志，不断假设验证

**以CPU占用过高的场景为例：[下载该问题的全部日志]()**

**从sys_log中，检索到了Watchdog的出现关键信息**

> TIPS: 在sys_log中搜索关键字"WATCHDOG KILLING SYSTEM PROCESS"

    10-14 17:10:51.548   892  1403 W Watchdog: *** WATCHDOG KILLING SYSTEM PROCESS: Blocked in handler on ActivityManager (ActivityManager)

这是一个Watchdog的**Looper Checker**超时，由于ActivityManager这个线程一直处于忙碌状态，导致Watchdog检查超时。
Watchdog出现的时间是**10-14 17:10:51.548**左右，需要从traces.txt中找到这个时间段的system_server进程的函数调用栈信息， system_server的进程号是892。

**从traces.txt中找到对应的函数调用栈**

traces.txt包含很多进程在不同时间段的函数调用栈信息，为了检索的方便，首先可以将traces.txt分块。
笔者写了一个[工具](https://github.com/duanqz)，可以从traces.txt文件中分割出指定进程号的函数调用栈信息。

> TIPS: 在system_server的traces中(通过工具分割出的system_server_892_2015-10-14-17:09:06文件)搜索关键字"ActivityManager"

    "ActivityManager" prio=5 tid=17 TimedWaiting
      | group="main" sCount=1 dsCount=0 obj=0x12c0e6d0 self=0x7f84caf000
      | sysTid=938 nice=-2 cgrp=default sched=0/0 handle=0x7f7d887000
      | state=S schedstat=( 107864628645 628257779012 60356 ) utm=7799 stm=2987 core=2 HZ=100
      | stack=0x7f6e68f000-0x7f6e691000 stackSize=1036KB
      | held mutexes=
      at java.lang.Object.wait!(Native method)
      - waiting on <0x264ff09d> (a com.android.server.am.ActivityManagerService$5)
      at java.lang.Object.wait(Object.java:422)
      at com.android.server.am.ActivityManagerService.dumpStackTraces(ActivityManagerService.java:5395)
      at com.android.server.am.ActivityManagerService.dumpStackTraces(ActivityManagerService.java:5282)
      at com.android.server.am.ActivityManagerService$AnrActivityManagerService.dumpStackTraces(ActivityManagerService.java:22676)
      at com.mediatek.anrmanager.ANRManager$AnrDumpMgr.dumpAnrDebugInfoLocked(SourceFile:1023)
      at com.mediatek.anrmanager.ANRManager$AnrDumpMgr.dumpAnrDebugInfo(SourceFile:881)
      at com.android.server.am.ActivityManagerService.appNotResponding(ActivityManagerService.java:6122)
      - locked <0x21c77912> (a com.mediatek.anrmanager.ANRManager$AnrDumpRecord)
      at com.android.server.am.BroadcastQueue$AppNotResponding.run(BroadcastQueue.java:228)
      at android.os.Handler.handleCallback(Handler.java:815)
      at android.os.Handler.dispatchMessage(Handler.java:104)
      at android.os.Looper.loop(Looper.java:192)
      at android.os.HandlerThread.run(HandlerThread.java:61)
      at com.android.server.ServiceThread.run(ServiceThread.java:46)

ActivityManager线程实际上运行着AMS的消息队列，这个函数调用栈的关键信息：

- 线程状态为TimedWaiting, 这表示当前线程阻塞在一个超时的wait()方法
- 正在处理广播消息超时发生的ANR(Application Not Responding)，需要将当前的函数调用栈打印出来
- 最终在<0x264ff09d>等待，可以从[AMS的源码]({{ site.android_source }}/platform/frameworks/base/+/master/services/core/java/com/android/server/am/ActivityManagerService.java#4830)
  中找到这一处锁的源码，因为dumpStackTraces()会写文件，所以AMS设计了一个200毫秒的超时锁。

{% highlight java %}
observer.wait(200);  // Wait for write-close, give up after 200msec
{% endhighlight %}

**还原问题的场景**

从ActivityManager这个线程的调用栈，我们就会有一些疑惑：

- 是哪个应用发生了ANR？为什么会发生ANR？
- 超时锁只用200毫秒就释放了，为什么会导致Watchdog检查超时？(AMS的Looper默认超时是1分钟)

带着这些疑惑，我们再回到日志中：

从sys_log中，可以检索到Watchdog出现的时间点(**17:10:51.548**)之前，com.android.systemui发生了ANR，从而引发AMS打印函数调用栈:

> TIPS: 在sys_log中检索"ANR in"关键字或在event_log中检索"anr"关键字

    10-14 17:10:04.215   892   938 E ANRManager: ANR in com.android.systemui, time=27097912
    10-14 17:10:04.215   892   938 E ANRManager: Reason: Broadcast of Intent { act=android.intent.action.TIME_TICK flg=0x50000114 (has extras) }
    10-14 17:10:04.215   892   938 E ANRManager: Load: 89.22 / 288.15 / 201.91
    10-14 17:10:04.215   892   938 E ANRManager: Android time :[2015-10-14 17:10:04.14] [27280.396]
    10-14 17:10:04.215   892   938 E ANRManager: CPU usage from 17016ms to 0ms ago:
    10-14 17:10:04.215   892   938 E ANRManager:   358% 23682/float_bessel: 358% user + 0% kernel
    10-14 17:10:04.215   892   938 E ANRManager:   57% 23604/debuggerd64: 3.8% user + 53% kernel / faults: 11369 minor
    10-14 17:10:04.215   892   938 E ANRManager:   2% 892/system_server: 0.9% user + 1% kernel / faults: 136 minor

从这个日志信息中，我们两个疑惑就释然了：

发生ANR之前的CPU负载远高于正常情况好几倍(Load： 89.22 / 288.15 / 201.91)，在这种CPU负载下，com.android.systemui进程发生处理广播消息超时(Reason: Broadcast of Intent)再正常不过了。
在这之前CPU都被**float_bessel**这个进程给占了，这货仅凭一己之力就耗了358%的CPU资源。

observer.wait(200)在调用后，便进入排队等待唤醒状态(Waiting)，在等待200毫秒后，便重新开始申请CPU资源，而此时，CPU资源一直被**float_bessel**占着没有释放，所以该线程一直在等CPU资源。
等了1分钟后，Watchdog跳出来说“不行，你已经等了1分钟了，handler处理其他消息了”。

在多核情况下，CPU的使用率统计会累加多个核的使用率，所以会出现超过100%的情况。那么**float_bessel**究竟是什么呢？它是一个Linux的测试样本，贝塞尔函数的计算，耗的就是CPU。

这样，该问题的场景我们就还原出来了：在压力测试的环境下，CPU被**float_bessel**运算占用，导致com.android.systemui进程发生ANR，从而引发AMS打印trace;
但由于AMS一直等不到CPU资源，Watchdog检测超时，杀掉system_server进程，系统重启。

对于压力测试而言，我们一般会设定一个通过标准，在某些压力情况下，出现一些错误是允许的。对于Android实际用户的使用场景而言，本例中的压力通常是不存在的，所以在实际项目中，这种类型的Watchdog问题，我们一般不解决。

# 5. 总结

Android中Watchdog用来看护system_server进程，system_server进程运行着系统最终要的服务，譬如AMS、PKMS、WMS等，
当这些服务不能正常运转时，Watchdog可能会杀掉system_server，让系统重启。

Watchdog的实现利用了锁和消息队列机制。当system_server发生死锁或消息队列一直处于忙碌状态时，则认为系统已经没有响应了(System Not Responding)。

在分析Watchdog问题的时候，首先要有详尽的日志，其次要能定位出导致Watchdog超时的直接原因，最重要的是能还原出问题发生的场景。

