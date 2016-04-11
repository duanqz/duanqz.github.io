---
layout: post
category: Android系统原理
title: dumpsys介绍
tagline:
tags:  Android调试
---
{% include JB/setup %}

# 1. 概要

`dumpsys`是Android提供的系统工具，可以用来查看所有系统服务的信息。

在命令行输入如下命令，就可以罗列出当前所有的系统服务名：

{% highlight console %}
$ adb shell dumpsys -l
Currently running services:
  ...
  SurfaceFlinger
  ...
  activity
  alarm
  ...
  battery
  batterystats
  ...
  meminfo
  ...
  window
{% endhighlight %}

如果`dumpsys`不追加任何参数，则会输出所有系统服务的详细信息，输出的内容是非常多的。实际解决具体问题时，我们通常只关注一些特定系统服务的输出，
只需要将服务名作为`dumpsys`命令的参数，就可以只输出特定服务的信息。譬如要输出磁盘使用的统计信息，则可以将**diskstats**这个系统服务名作为参数：

{% highlight console %}
$ adb shell dumpsys diskstats
Latency: 0ms [512B Data Write]
Data-Free: 6589272K / 12258876K total = 53% free
Cache-Free: 337720K / 420552K total = 80% free
System-Free: 306024K / 1523568K total = 20% free
{% endhighlight %}

# 2. 工作原理

`dumpsys`是Android上的一个二进制程序， 在命令行输出`adb shell dumpsys xx`命令，会通过**adb**将**dumpsys xx**发送到移动设备执行
(**adb的工作原理可以参见[adb介绍](/2015-05-21-Intro-adb)一文**)，
收到**dumpsys xx**指令后，`dumpsys`这个二进制程序就开始工作了，`dumpsys`本身只提供一个输出框架，具体的输出内容还是交由实际的系统服务完成。

下图是`dumpsys`的工作原理：

<div align="center"><img src="/assets/images/dumpsys/1-dumpsys-how-to-work.png" alt="dumpsys工作原理"/></div>

## 2.1 dumpsys的代码逻辑

`dumpsys`由[frameworks/native/cmds/dumpsys/dumpsys.cpp]({{ site.android_source }}/platform/frameworks/native/+/master/cmds/dumpsys/dumpsys.cpp)这个文件中编译得到。
我们截取该文件主要的代码片段来分析一下：

{% highlight c %}
int main(int argc, char* const argv[])
{
    ...
    // 1. 首先获取 servicemanager
    sp<IServiceManager> sm = defaultServiceManager();
    ...
    // 2. 进行命令行参数解析
    bool showListOnly = false;
    if ((argc == 2) && (strcmp(argv[1], "-l") == 0)) {
        // 2.1 当参数仅为 "-l" 时，设置只罗列出所有的服务名
        showListOnly = true;
    }
    if ((argc == 1) || showListOnly) {
        // 2.2 当不带任何参数时，则附加 "-a" 参数，表示输出所有系统服务信息
        services = sm->listServices();
        services.sort(sort_func);
        args.add(String16("-a"));
    } else {
        // 2.3 当带了一个参数时，表示仅输出指定的系统服务信息
        services.add(String16(argv[1]));
        for (int i=2; i<argc; i++) {
            args.add(String16(argv[i]));
        }
    }

    // 3. 罗列出services这个数组中的服务名称，到这一步为止，都还只是在dumpsys本身的逻辑中转悠
    const size_t N = services.size();
    if (N > 1) {
        aout << "Currently running services:" << endl;    
        for (size_t i=0; i<N; i++) {
            sp<IBinder> service = sm->checkService(services[i]);
            if (service != NULL) {
                aout << "  " << services[i] << endl;
            }
        }
    }
    if (showListOnly) {
        return 0;
    }

    // 4. 输出services这个数组中所包含系统服务的详细信息
    for (size_t i=0; i<N; i++) {
        sp<IBinder> service = sm->checkService(services[i]);
        if (service != NULL) {
            ...
            // 4.1 调用service的dump方法，来输出service的具体信息
            int err = service->dump(STDOUT_FILENO, args);
            ...
        }
        ...
    }
    return 0;
}
{% endhighlight %}

代码逻辑并不复杂，按照如下逻辑执行：

1. 获取servicemanager，所有的系统服务都会向servicemanager注册
2. 进行命令行参数解析，根据参数的不同设置后续的执行指令序列
3. 简单的罗列了一下需要输出的系统服务名称
4. 真正完成系统服务详细信息的输出

关键在第4步的实现，调用具体系统服务的**dump()**方法。

## 2.2 系统服务的dump方法

Android中，所有的系统服务都是**Binder**的子类，**Binder**作为一个抽象的概念，用来描述一个远程对象，
这里有几个基础知识：

- Android中的系统服务，譬如ActivityManagerService, PackageManagerService， BatteryStatsService等都是运行在**system_server**这个进程中，
  在Android启动的时候，就会按照系统服务的重要性，按序来启动这些的系统服务，它们作为服务端，为整个Android系统提供服务支撑。
  
- Android中的应用程序是运行在独立的进程中的，如过某个应用程序需要使用系统服务，则需要发起跨进程调用(Remote Procedure Call， RPC),应用程序将作为客户端，
  与系统服务进行数据交换。

- Android上实现RPC的机制就是**Binder**，当客户端获取到**Binder**时，就可以理解为客户端跟系统服务建立绑定关系，这时，**Binder**就代表了远程系统服务。
  实际的系统服务，都是**Binder**的子类，需要实现**Binder**定义的抽象方法，其中**Binder.dump()**这个方法就是专门为输出系统服务的信息而生。

- **Binder.dump()**这个方法的实现，完全由实际的系统服务来控制，可以附加访问权限，可以输出任何信息，甚至可以为空实现。如果某个系统服务的**dump()**方法
  为空实现，那么使用`dumpsys`输出这个信息服务的信息就为空。

以**DiskStatsService.dump()**这个方法为例，在命令行输出`adb shell dumpsys diskstats`，最终的实现就落到该方法中：

{% highlight java %}
protected void dump(FileDescriptor fd, PrintWriter pw, String[] args) {
    // 1. 权限检查
    mContext.enforceCallingOrSelfPermission(android.Manifest.permission.DUMP, TAG);

    // 2. 生成一个大小为512B的临时文件
    byte[] junk = new byte[512];
    for (int i = 0; i < junk.length; i++) junk[i] = (byte) i;  // Write nonzero bytes
    File tmp = new File(Environment.getDataDirectory(), "system/perftest.tmp");

    // 3. 将512B的临时文件写入磁盘，目的是为了快速的测试写磁盘的延迟
    long before = SystemClock.uptimeMillis();
    ...
    fos = new FileOutputStream(tmp);
    fos.write(junk);
    ...
    long after = SystemClock.uptimeMillis();
    ...
    pw.print("Latency: ");
    pw.print(after - before);
    pw.println("ms [512B Data Write]");
    ...
    // 4. 输出Data, Cache和System这几个分区的磁盘使用信息
    reportFreeSpace(Environment.getDataDirectory(), "Data", pw);
    reportFreeSpace(Environment.getDownloadCacheDirectory(), "Cache", pw);
    reportFreeSpace(new File("/system"), "System", pw);
    ....
}
{% endhighlight %}

# 3. 解析dumpsys输出

对`dumpsys`输出内容的理解需要有相关领域的知识，能够理解这些日志，对Android性能调优、Bug调试都有很大的帮助，这也是一个Android系统开发人员的必备技能。

笔者分析了常见系统服务的`dumpsys`日志输出：

- [dumpsys batterystats]()
- [dumpsys meminfo]()
- [dumpsys diskstats]()

目前，已经有一些工具，对`dumpsys`的输出内容进行解析，并作图形化的展示，便于系统开发人员分析问题。例如：

- [Battery Historian](https://github.com/google/battery-historian) 分析**batterystats**这个系统服务的dumpsys输出，生成HTML页面
- [Android Log Suite](https://github.com/duanqz/androidlogsuite) 
