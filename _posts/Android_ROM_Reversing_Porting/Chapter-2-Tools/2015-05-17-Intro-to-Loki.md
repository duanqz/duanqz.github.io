---
layout: post
title: Loki介绍
category: 工具使用
tagline: Loki
tags: [Loki]
---
{% include JB/setup %}

`Loki`这个工具最早由Dan Rosenberg在[XDA](http://www.xda-developers.com/)上发布,用来对kenerl进行patch,绕过三星Galaxy S4上的Bootloader校验,不断更新后,已经支持很多Samsumg和LG的机型。
很多第三方的刷机方案都用到了Loki,譬如: [CyanogenMod](http://www.cyanogenmod.org/), [AutoRec](http://forum.xda-developers.com/showthread.php?t=2715496)。

`Loki`是开源的,GitHub上有源码可供下载: <https://github.com/djrbliss/loki>

当前版本(2015.04.20)已经编译好了可以在ARM上运行的loki_tool,位于bin目录下,可以直接将这个二进制 Push到手机上运行。

# 使用介绍

{% highlight console %}
Loki tool v2.1
Usage

$ loki_tool [patch] [boot|recovery] [aboot.img] [in.img] [out.lok]
  对 in.img 进行 Patch,生成可以绕过 Bootloader 的 out.lok
  要求一个输入参数 aboot.img,简单理解成为 Bootloader 分区的镜像
  在拥有手机的 ROOT 权限后,可以从手机中把 aboot.img 取出来
  使用该命令对 boot.img 或 recovery.img 进行 Patch
    
$ loki_tool [flash] [boot|recovery] [in.lok]
  使用该命令将 Patch 后的 img 刷入指定的分区
    
$ loki_tool [find] [aboot.img]
  使用该命令可以判定 loki 是否支持绕过当前手机的 Bootloader 校验
  对于 Android 4.4及以上版本的 aboot.img,使用该命令,会提示错误信息:
  [-] Could not find boot_linux_from_mmc

$ loki_tool [unlok] [in.lok] [out.img]
  使用该命令可以对 Patch 过后的 image 还原。

{% endhighlight %}

针对一款具体的手机而言,我们需要获取ROOT权限,才能正常使用`Loki`的功能。以LG G2(D802)为例：

首先,需要获取手机的Bootloader分区镜像aboot.img,才能够计算出Bootloader签名验证函数check_sig()和内核加载函数boot_linux_from_mmc()的偏移值。在拿到ROOT权限后,可以直接从手机的aboot分区,将aboot.img 镜像取出来:

{% highlight console %}
$ dd if=/dev/block/platform/msm_sdcc.1/by-name/aboot of=aboot.img
{% endhighlight %}

然后,需要对定制过的boot.img或recovery.img 进行Patch,得到可以绕过Bootloader 校验的 boot.lok 或 recovery.lok:

{% highlight console %}
$ loki_tool patch boot aboot.img boot.img boot.lok
{% endhighlight %}

最后,建议使用 loki_tool 将 boot.lok 或 recovery.lok 刷人手机的对应分区。当然,
也可以使用 dd 命令来刷写分区,但 loki_tool 在刷入之前,还会对镜像文件做检查:

{% highlight console %}
$ loki_tool flash boot boot.lok
{% endhighlight %}


# CyanogenMode如何使用Loki

以LG G2(D802)为例，我们可以从CM的刷机包中,看到`Loki`的真实使用过程:

解开一个[LG G2(D802)的卡刷包](http://download.cyanogenmod.org/?device=d802),打开 META-INF/com/google/android/updater-script文件,其中有一行命令:

    assert(run_program("/system/bin/loki.sh") == 0);

表示执行/system/bin/loki.sh 这个脚本,打开这个脚本,里面的内容如下:

{% highlight powershell %}
export C=/tmp/loki_tmpdir
mkdir -p $C
dd if=/dev/block/platform/msm_sdcc.1/by-name/aboot of=$C/aboot.img
/system/bin/loki_tool patch boot $C/aboot.img /tmp/boot.img $C/boot.lok || exit 1
/system/bin/loki_tool flash boot $C/boot.lok || exit 1
rm -rf $C
exit 0
{% endhighlight %}

该脚本的主要过程是:

1. 将手机上的aboot.img 通过dd命令,导出到临时目录;

2. 利用loki_tool, 将新导出aboot.img作为输入参数,对待刷入的boot.img进行patch,生成一个可以绕过 Bootloader校验的boot.lok

3. 将boot.lok刷入boot分区

可以看到,第三方的 boot.img 并不是直接刷入,而是在手机上通过 loki 处理后,再刷入的。


# 编译PC版本的Loki

`Loki`并不仅仅只限于在手机上运行,该一下编译配置,就可以编译出在PC上运行的版本。从GitHub下载完 Loki 的源码后,打开根目录下得Makefile文件,将其中的
**CC := arm-linux-androideabi-gcc**
修改为:
**CC := gcc**
然后执行 make,就可以编译出在PC上运行的loki_tool.