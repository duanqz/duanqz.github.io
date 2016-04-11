---
layout: post
category: Android系统原理
title: StrictMode机制以及使用场景
tagline:
tags:  Android调试 稳定性
---
{% include JB/setup %}

# 1. 概览

`StrictMode`，严苛模式，是Android提供的一种运行时检测机制，用于检测代码运行时的一些不规范的操作，最常见的场景是用于发现主线程的IO操作。

`StrictMode`包含两个维度的概念：

- **Policy(策略)**: 是指StrictMode对一些违规操作的发现策略，分为两类：一类是针对一个具体的线程(ThreadPolicy)，另一类是针对虚拟机的所有对象(VMPolicy)。

- **Penalty(惩罚)**：是指StrictMode发现违规操作后进行惩罚的方式，譬如绘制红框、打印日志、显示对话框、杀掉进程等。

Android在很多关键的代码路径上都植入了StrictMode， 譬如磁盘读写、网络访问、系统进程启动等。StrictMode会根据设置的策略进行检查，如果某个进程在代码运行时出现了违规操作，那么就会受到"惩罚"。

应用程序可以利用StrictMode尽可能的发现一些编码的疏漏，
Android在 [packages/experimental/StrictModeTest]({{ site.android_source }}/platform/packages/experimental/+/master/StrictModeTest/) 这个APK中提供了常见违规操作的样例，
谨作为大家的反面教材。

本文深入分析StrictMode背后的实现原理以及使用场景。

# 2. StrictMode机制

StrictMode的实现涉及到以下源码：

- [libcore/dalvik/src/main/java/dalvik/system/BlockGuard.java]({{ site.android_source }}/platform/libcore/+/master/dalvik/src/main/java/dalvik/system/BlockGuard.java)
- [libcore/dalvik/src/main/java/dalvik/system/CloseGuard.java]({{ site.android_source }}/platform/libcore/+/master/dalvik/src/main/java/dalvik/system/CloseGuard.java)
- [frameworks/base/core/java/android/os/StrictMode.java]({{ site.android_source }}/platform/frameworks/base/+/master/core/java/android/os/StrictMode.java)

总体而言，StrictMode机制所涉及到的代码量并不大，但Android中植入StrictMode的地方都是一些重要的关口，StrictMode所体现的面向接口编程的思想以及设计模式的应用，值得我们好好学习。
下面，我们就深入源码，分析一下StrictMode机制的内部实现。

## 2.1 BlockGuard和CloseGuard

StrictMode针对单个线程和虚拟机的所有对象都定义了检查策略，用来发现一些违规操作，譬如：主线程中的磁盘读/写、网络访问、未关闭cursor，这些操作都能够被StrictMode检查出来。
怎么做到的呢？在做这些操作时，植入StrictMode的检查代码就可以了。有一部分植入代码是建立在BlockGuard和CloseGuard之上的，可以说，StrictMode是建立在BlockGuard和CloseGuard之上的机制。

**Guard**有“守卫”的意思，Block是阻塞的意思，在进行一些耗时操作时，譬如磁盘读写、网络操作，有一个守卫在监测着，它就是BlockGuard，如果这些耗时的操作导致主线程阻塞，BlockGuard就会发出通知;
Close对应到可打开的文件，在文件被打开后，也有一个守卫在监测着，它就是CloseGuard，如果没有关闭文件，则CloseGuard就会发出通知。

Android在很多代码中植入了BlockGuard，以BlockGuardOs为例，这个类代理大部分POSIX系统调用接口，所谓代理，从代码角度，就是在一个类外层再做一层封装。
BlockGuardOs代理了Os类，并植入了BlockGuard，譬如**BlockGuardOs.read()**这个系统调用：

{% highlight java %}
public int read(FileDescriptor fd, byte[] bytes, int byteOffset, int byteCount) throws ErrnoException, InterruptedIOException {
    BlockGuard.getThreadPolicy().onReadFromDisk();
    return os.read(fd, bytes, byteOffset, byteCount);
}
{% endhighlight %}

经过BlockGuard的一层封装，在每次进行read()系统调用时，都会通过BlockGuard通知发生了读磁盘的操作：**BlockGuard.getThreadPolicy().onReadFromDisk()**

这里用到了BlockGuard的getThreadPolicy()方法，其实BlockGuard内部有一个Policy，定义了可能导致阻塞的方法：

{% highlight java %}
public interface Policy {
    void onWriteToDisk();
    void onReadFromDisk();
    void onNetwork();
    int getPolicyMask();
}
{% endhighlight %}

这个Policy只是一个接口定义，专门暴露给外部的 ，StrictMode就实现了BlockGuard.Policy：

{% highlight java %}
private static class AndroidBlockGuardPolicy implements BlockGuard.Policy {

    public void onWriteToDisk() {...}

    public void onReadFromDisk() {...}

    public void onNetwork() {...}

    void onCustomSlowCall(String name) {...}

    int getPolicyMask() {...}
}
{% endhighlight %}

StrictMode不仅针对BlockGuard.Policy实现了自身的处理逻辑，还扩展了一个方法onCustomSlowCall()，通过**BlockGuard.setThreadPolicy()**就能够将AndroidBlockGuardPolicy植入到BlockGuard中。

再来看CloseGuard，与BlockGuard一样，Android在很多代码中也植入了CloseGuard，以FileInputStream为例：

{% highlight java %}
public class FileInputStream extends InputStream {
    // 1. 新建CloseGuard全局变量
    private final CloseGuard guard = CloseGuard.get();

    public FileInputStream(File file) throws FileNotFoundException {
        ...
        // 2. 设置CloseGuard标志
        guard.open("close");
    }

    public void close() throws IOException {
        // 3. 清除CloseGuard标志
        guard.close();
        ...
    }

    protected void finalize() throws IOException {
        // 4. 判断Close标志是否被清除
        if (guard != null) {
            guard.warnIfOpen();
        }
        ...
    }
}
{% endhighlight %}

CloseGuard的植入逻辑很清晰，一共分为4部分：

1. 新建一个CloseGuard全局变量
2. 在对象初始化时，设置一个标志，表示需要调用close()方法关闭该对象
3. 在关闭方法中，调用**CloseGuard.close()**方法，清除标志
4. 在对象销毁时，调用**CloaseGuard.warnIfOpen()**方法，判断标志是否被清除：

{% highlight java %}
public void warnIfOpen() {
    if (allocationSite == null || !ENABLED) {
        return;
    }

    String message =
        ("A resource was acquired at attached stack trace but never released. "
        + "See java.io.Closeable for information on avoiding resource leaks.");

    REPORTER.report(message, allocationSite);
}
{% endhighlight %}

从**CloseGuard.warnIfOpen()**方法中，可以看到，设置的标志就是**allocationSite**变量，如果该变量已经置空了，表示已经被清除过了; 否则，就会通过REPORTER报告违规操作。

REPORTER是CloseGuard暴露一个接口，StrictMode就实现了这个接口：

{% highlight java %}
private static class AndroidCloseGuardReporter implements CloseGuard.Reporter {
    public void report (String message, Throwable allocationSite) {
        onVmPolicyViolation(message, allocationSite);
    }
}
{% endhighlight %}

当StrictMode启用时，REPORTER就被设置成了AndroidCloseGuardReporter对象，如此一来，StrictMode就能够收集到CloseGuard报告的未关闭文件。

**至此，我们揭开了StrictMode的面纱：Android通过BlockGuard和CloseGuard在一些执行路径中埋入了一些切点，譬如磁盘读写时BlockGuard会收到通知，对象销毁时CloseGuard就会收到通知。**
**BlockGuard和CloseGuard都设计了一套接口：BlockGuard.Policy和CloseGuard.Reporter，其实就是切点的不同分类，StrictMode正是利用这两个接口所定义的一些切点，切入了自已的处理逻辑。**

> **题外话:** 得益于面向接口的设计，我们可以另起炉灶，完全独立于StrictMode再实现其他BlockGuard.Policy和CloseGuard.Reporter的处理逻辑;
> 也可以对BlockGuard.Policy和CloseGuard.Reporter进行扩展，StrictMode只需要实现新的处理逻辑即可，这都不会影响已有的架构。
> 接口定义和接口实现分离，两者可以独立变化，适应新的需求，这是桥接模式(Bridge Pattern)的精髓，它降低了Guard和StrictMode两者之间的耦合度。<br/>
> 从BlockGuardOs的设计中，我们也看到了代理模式(Proxy Pattern)，BlockGuardOs对被代理的Os类进行了简单控制，植入了BlockGuard的逻辑，作为一个中间者，处于调用者和被调用实体中间，能够降低两者的耦合度。

## 2.2 StrictMode Policy

StrictMode利用了BlockGuard和CloseGuard，不仅实现了两者定义的一些策略(Policy)，还进行了扩展。
这些策略，在StrictMode看来，就是一些违规操作，下面我们深入介绍StrictMode定义的每一项违规操作。

### 2.2.1 ThreadPolicy

ThreadPolicy细分为以下几种：

- **Disk Write**：实现了BlockGuard的策略，写磁盘操作
- **Disk Read**：实现了BlockGuard的策略，读磁盘操作
- **Network Access**：实现了BlockGuard的策略，网络访问操作
- **Custom Slow Code**：StrictMode扩展的策略，目前只有Webview中植入了这项检查

前三项的植入都是通过BlockGuard完成的，StrictMode只是实现了处理逻辑;最后一项是StrictMode扩展的，
如果一个方法执行的时间较长，可以调用**StrictMode.noteSlowCall()**方法来发出通知。
当这些操作发生后，最终都会调用**StrictMode.handleViolation()**方法进行处理，后文再展开讨论这个方法。

StrictMode通过标志位来区别以上几项，为此还特意封装了一个内部类**StrictMode.ThreadPlicy**，目的是为了方便标志位的设定。

{% highlight java %}
public static final class ThreadPolicy {
    // ThreadPolicy标志位
    final int mask;
    private ThreadPolicy(int mask) {
            this.mask = mask;
    }

    // 利用Builder完成标志位的初始化
    public static final class Builder {
        private int mMask = 0;

        public Builder detectDiskReads() {
            return enable(DETECT_DISK_READ);
        }
    }
}
{% endhighlight %}

ThreadPolicy的初始化采用了**构建者模式(Builder Pattern)**，这样一来，调用者在使用起来就会更加自然一点，不用记住各个标志位的意义。
为了完成标志位的设定，StrictMode提供setThreadPolicy()方法，接收ThreadPolicy类型的对象作为参数，该方法的实现就是直接调用setThreadPolicyMask()：

{% highlight java %}
public static void setThreadPolicy(final ThreadPolicy policy) {
    setThreadPolicyMask(policy.mask);
}

pivate static void setThreadPolicyMask(final int policyMask) {
    setBlockGuardPolicy(policyMask);
    Binder.setThreadStrictModePolicy(policyMask);
}
{% endhighlight %}

这里完成了两个层面的ThreadPolicy设定：

- **Java层**，通过**StrictMode.setBlockGuardPolicy()**完成，最终会调用**BlockGuard.setThreadPolicy()**方法，
将AndroidBlockGuardPolicy对象设定为BlockGuard的Policy;

- **Native层**，通过**Binder.setThreadStrictModePolicy()**完成，看到这里，想必各位读者心中有了疑问，为什么还会有Native层的ThreadPolicy设置？
  其实，看到Binder，就很容易联想到这是用作跨进程调用的，当**进程A**发起跨进程调用进入到**进程B**后，那**进程B**中的违规操作怎么判定呢？当然也需要一个ThreadPolicy，
  Binder.setThreadStrictModePolicy()就是用来设置其他进程的ThreadPolicy。**进程B**中的违规异常也会通过Binder再传回**进程A**中，如此一来，
  一个方法执行路径上的所有违规操作都会被StrictMode发现。

### 2.2.2 VMPolicy

ThreadPolicy主要用于发现一些容易导致主线程阻塞的操作，所以它针对的对象是单个线程; 而VMPolicy主要用于发现Java层的内存泄漏，所以它针对的是虚拟机的所有对象。
VMPolicy细分为以下几种：

- **Cursor Leak**： 如果注册SQlite Cursor后没有调用close()，则发生了泄漏。
- **Closable Leak**： 这一项是CloseGuard的实现。如果存在未关闭的对象，则发生了泄漏。
- **Activity Leak**： 如果Activity在销毁后，其对象引用还被持有，则发生了泄漏。
- **Instance Leak**： StrictMode允许设置一个类的对象数量上限，在系统闲时，Strict会统计虚拟机中实际的对象数量，如果超出设定的上限，则判定为对象泄漏。
- **Registion Leak**： 如果注册IntentReceiver后没有调用unregisterReceiver()，则发生了泄漏
- **File URI Exposure**：这一项是安全性检查。通过file://的方式共享文件时，存在安全隐患。Android建议通过content://的方式共享文件。

如同ThreadPolicy一样，VMPolicy也采用了**构建者模式(Builder Pattern)**进行初始化，在**Closable Leak**这一项的使用上，与BlockGuard有异曲同工之妙，
但除了**Closable Leak**是利用CloseGuard以外，其他违规项都是StrictMode自身的逻辑，需要在一些关键路径上植入StrictMode的代码，我们举出两例：

**例1：Cursor Leak**

以下是SQLite Cursor植入了StrictMode机制的代码片段：

{% highlight java %}
public SQLiteCursor(SQLiteCursorDriver driver, String editTable, SQLiteQuery query) {
    ...
    if (StrictMode.vmSqliteObjectLeaksEnabled()) {
        mStackTrace = new DatabaseObjectNotClosedException().fillInStackTrace();
    } else {
        mStackTrace = null;
    }
    ...
}

protected void finalize() {
    try {
        // if the cursor hasn't been closed yet, close it first
        if (mWindow != null) {
            if (mStackTrace != null) {
                String sql = mQuery.getSql();
                int len = sql.length();
                StrictMode.onSqliteObjectLeaked(
                    "Finalizing a Cursor that has not been deactivated or closed. " +
                    "database = " + mQuery.getDatabase().getLabel() +
                    ", table = " + mEditTable +
                    ", query = " + sql.substring(0, (len > 1000) ? 1000 : len),
                    mStackTrace);
            }
            close();
        }
    } finally {
        super.finalize();
    }
}
{% endhighlight %}

在SQLiteCursor对象初始化时，设置一个变量mStackTrace，如果开启了**DETECT_VM_CURSOR_LEAKS**，则将其置为非空。
在SQLiteCursor对象销毁时，会对Cursor是否关闭进行判断(如果CursorWindow非空，则说明没有显示关闭Cursor)。此时，如果mStackTrace变量非空，则向StrictMode报告。

**例2：Activity Leak**

再来一例Activity植入StrictMode的逻辑：

    ActivityThread.performLaunchActivity()
    └── StrictMode.incrementExpectedActivityCount()

    ActivityThread.performDestroyActivity()
    └── StrictMode.decrementExpectedActivityCount()

StrictMode对象中维护了Activity的计数器，统计着Activity对象的数量。在Activity对象新建和销毁的时候，会分别调用increment和decrement，对计数进行增减调整。
每一次有Activity对象销毁，都会调用**VMDebug.countInstancesOfClass()**，计算虚拟机中实际的Activity对象数量，如果实际Activity对象的数量超出了StrictMode的统计值，
则说明Activity对象虽然销毁了，但其对象引用还在，这就存在泄漏。

{% highlight java %}
public static void decrementExpectedActivityCount(Class klass) {
    ...
    long instances = VMDebug.countInstancesOfClass(klass, false);
    if (instances > limit) {
        Throwable tr = new InstanceCountViolation(klass, instances, limit);
        onVmPolicyViolation(tr.getMessage(), tr);
    }
}
{% endhighlight %}

从上述两例中，我们看到，虽然检测的形式各有不同，但本质都是在被检测的对象初始化时(constructor)设置一个标志，在对象销毁时(finalize)再对这个标志进行判断。其他的检测项的实现方式也都大同小异。

## 2.3 StrictMode Penalty

当StrictMode发现有违规操作后，提供一些惩罚的方式，使用者可以自行组合。

- **penaltyDialog**： 弹出对话框
- **penaltyDeath**： 杀掉进程
- **penaltyDeathOnNetwork**
- **penaltyFlashScreen**： 在屏幕的最外围绘制一个红框
- **penaltyLog**：打印StrictMode日志
- **penaltyDropBox**：将日志保存到Dropbox中

StrictMode内部是通过标志位来记录惩罚操作的类型的，并提供了上述的方法来设置不同的标志位。
StrictMode检测到违规操作后，最终都会调用**StrictMode.handleViolation()**方法，该方法中就会根据设置的标志位进行惩罚：

{% highlight java %}
void handleViolation(final ViolationInfo info) {
    final boolean justDropBox = (info.policy & THREAD_PENALTY_MASK) == PENALTY_DROPBOX;
    if (justDropBox) {
        dropboxViolationAsync(violationMaskSubset, info);
        return;
    }
    ...
    ActivityManagerNative.getDefault().handleApplicationStrictModeViolation(
                    RuntimeInit.getApplicationObject(),
                    violationMaskSubset,
                    info);
    ...
    if ((info.policy & PENALTY_DEATH) != 0) {
        executeDeathPenalty(info);
    }
}
{% endhighlight %}

方法的实现逻辑一目了然，最终通过Binder发起跨进程调用，走到**ActivityManagerService.handleApplicationStrictModeViolation()**中

# 3. StrictMode使用

StrictMode机制只是用于发现一些违规操作，这些违规操作一般都是我们编码的疏漏，在运行时会被StrictMode暴露出来，但StrictMode并非真正意思上的“动态代码检查”。
各位读者有必要知道StrictMode的使用范围：

- StrictMode只是用在开发调试阶段，在正式发布时，应该关掉StrictMode
	- AOSP的源码中，USER版并没有打开StrictMode
	- 由于Android还会对StrictMode的检查策略进行调整，所以Google Play建议上架的APK都关闭StrictMode;
	  从另一个角度，Google认为所有StrictMode的错误，在正式发布前，都应该解决。

- StrictMode并不能发现Native层的违规操作，仅仅是用在Java层

StrictMode的使用场景可以分为三类，使用方式也都比较固定，可见StrictMode的对外接口还是封装得比较优美的。
下面，我们逐个介绍一下StrictMode的使用场景。

## 3.1 普通应用开启StrictMode

对于应用程序而言，Android提供了一个最佳使用实践：尽可能早的在**android.app.Application**或**android.app.Activity**的生命周期使能StrictMode，
onCreate()方法就是一个最佳的时机，越早开启就能在更多的代码执行路径上发现违规操作。

{% highlight java %}
public void onCreate() {
    if (DEVELOPER_MODE) {
       StrictMode.setThreadPolicy(new StrictMode.ThreadPolicy.Builder()
               .detectDiskReads()
               .detectDiskWrites()
               .detectNetwork()   // or .detectAll() for all detectable problems
               .penaltyLog()
               .build());
       StrictMode.setVmPolicy(new StrictMode.VmPolicy.Builder()
               .detectLeakedSqlLiteObjects()
               .detectLeakedClosableObjects()
               .penaltyLog()
               .penaltyDeath()
               .build());
    }
    super.onCreate();
}
{% endhighlight %}

以上StrictMode的使能代码限定在**DEVELOPER_MODE**：

- 设定了Disk Read, Disk Write, Network Access三项ThreadPolicy，惩罚是打印日志;
- 设定了Cursor Leak, Closable Leak两项VMPolicy，惩罚是打印日志和杀掉进程。

当出现一些ThreadPolicy相关违规操作时，Android也提供了很多标准的解决方案，譬如**Handler， AsyncTask， IntentService**，能够将耗时的操作从主线程中分离出来。

## 3.2 系统应用开启StrictMode

对于Android系统应用和系统进程(system_server)而言，其实默认就会开启StrictMode。
StrictMode提供了**conditionallyEnableDebugLogging()**方法：

{% highlight java %}
public static boolean conditionallyEnableDebugLogging() {
    boolean doFlashes = SystemProperties.getBoolean(VISUAL_PROPERTY, false)
                && !amTheSystemServerProcess();
    final boolean suppress = SystemProperties.getBoolean(DISABLE_PROPERTY, false);
    if (!doFlashes && (IS_USER_BUILD || suppress)) {
        setCloseGuardEnabled(false);
        return false;
    }

   int threadPolicyMask = StrictMode.DETECT_DISK_WRITE |
            StrictMode.DETECT_DISK_READ |
            StrictMode.DETECT_NETWORK;
    ...
    if (!IS_USER_BUILD) {
        threadPolicyMask |= StrictMode.PENALTY_DROPBOX;
    }

    StrictMode.setThreadPolicyMask(threadPolicyMask);
    if (IS_USER_BUILD) {
        setCloseGuardEnabled(false);
    } else {
        VmPolicy.Builder policyBuilder = new VmPolicy.Builder().detectAll().penaltyDropBox();
        ...
        setVmPolicy(policyBuilder.build());
        setCloseGuardEnabled(vmClosableObjectLeaksEnabled());
    }
    return true;
}
{% endhighlight %}

该方法的目的就是要设置ThreadPolicy和VMPolicy，不过会有一些条件判断，具体的逻辑不表。我们来看一下调用这个方法的地方：

    SystemServer.run()
    ServiceThread.run()
    ActivityThread.handleBindApplication()
    └── StrictMode.conditionallyEnableDebugLogging()

这表示在system_server进程、一些全局的消息线程(IoThread, UiThread, FgThread, DisplayThread)、应用进程这些东西启动的时候开启StrictMode。
在**ActivityThread.handleBindApplication()**中有这么一段限制：

{% highlight java %}
private void handleBindApplication(AppBindData data) {
    ...
    if ((data.appInfo.flags &
         (ApplicationInfo.FLAG_SYSTEM |
          ApplicationInfo.FLAG_UPDATED_SYSTEM_APP)) != 0) {
        StrictMode.conditionallyEnableDebugLogging();
    }
    ...
}
{% endhighlight %}

表示只为系统应用(**FLAG_SYSTEM, FLAG_UPDATED_SYSTEM_APP**)开启了StrictMode，其他应用还是需要自行开启。

## 3.3 临时关闭StrictMode

对于某些操作而言，我们明确知道是StrictMode定义的违规操作，但实际上对性能并没有什么影响，那么，在执行这类操作的时候，可以临时关闭StrictMode。
譬如针对一些主线程快速写磁盘的操作：

{% highlight java %}
StrictMode.ThreadPolicy old = StrictMode.getThreadPolicy();
StrictMode.setThreadPolicy(new StrictMode.ThreadPolicy.Builder(old)
                                 .permitDiskWrites()
                                 .build());
// 进行磁盘写操作...
StrictMode.setThreadPolicy(old);
{% endhighlight %}

首先，将旧的ThreadPolicy缓存一把; 然后，设置新的ThreadPolicy，并允许写磁盘操作; 最后，在进行完正常的写磁盘操作后，还原旧的ThreadPolicy。
这样就临时性的避开了StrictMode对写磁盘操作的检查。
