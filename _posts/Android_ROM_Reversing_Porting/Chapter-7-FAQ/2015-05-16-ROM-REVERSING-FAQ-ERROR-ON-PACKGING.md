---
layout: post
title: ROM逆向适配——常见错误4
category: ROM逆向适配
tagline: 常见打包错误
tags: [打包错误]
---
{% include JB/setup %}

分析打包失败的错误

## 函数数量超容

**错误提示**

{% highlight console %}
I: Using Apktool 2.0.0 
I: Checking whether sources has changed... 
I: Smaling smali folder into classes.dex... 
Exception in thread "main" org.jf.util.ExceptionWithContext: Unsigned short value out of range: 67380 
    	at org.jf.dexlib2.writer.DexDataWriter.writeUshort(DexDataWriter.java:116) 
    	at org.jf.dexlib2.writer.InstructionWriter.write(InstructionWriter.java:312) 
    	at org.jf.dexlib2.writer.DexWriter.writeCodeItem(DexWriter.java:990) 
    	at org.jf.dexlib2.writer.DexWriter.writeDebugAndCodeItems(DexWriter.java:769) 
    	at org.jf.dexlib2.writer.DexWriter.writeTo(DexWriter.java:222) 
    	at org.jf.dexlib2.writer.DexWriter.writeTo(DexWriter.java:200) 
    	at brut.androlib.src.SmaliBuilder.build(SmaliBuilder.java:57) 
    	at brut.androlib.src.SmaliBuilder.build(SmaliBuilder.java:41) 
    	at brut.androlib.Androlib.buildSourcesSmali(Androlib.java:354) 
    	at brut.androlib.Androlib.buildSources(Androlib.java:294) 
    	at brut.androlib.Androlib.build(Androlib.java:280) 
    	at brut.androlib.Androlib.build(Androlib.java:255) 
    	at brut.apktool.Main.cmdBuild(Main.java:225) 
    	at brut.apktool.Main.main(Main.java:84) 

make[1]: *** [out/obj/system/framework/framework.jar] Error 161 
make[1]: Leaving directory `/home/duanqizhi/source/smali-5.0/devices/g2_cm' 
make: *** [ota] Error 2 
{% endhighlight %}

**出错原因**

通常是Android 5.0以上的版本，回编译framework.jar时，单个包的函数数量超过`65535`的限制导致的。
在Android 5.0以下的版本，回编译时，也会有函数数量超过限制的错误，报错信息如下：

{% highlight console %}
I: Checking whether sources has changed...
I: Smaling...
Exception in thread "main" org.jf.dexlib.Util.ExceptionWithContext: method index is too large.
    at org.jf.dexlib.Util.ExceptionWithContext.withContext(ExceptionWithContext.java:54)
    at org.jf.dexlib.Item.addExceptionContext(Item.java:177)
    at org.jf.dexlib.Item.writeTo(Item.java:120)
    ... more
    at brut.apktool.Main.cmdBuild(Main.java:185)
    at brut.apktool.Main.main(Main.java:70)
Caused by: java.lang.RuntimeException: method index is too large. 
    at org.jf.dexlib.Code.Format.Instruction35c.writeInstruction(Instruction35c.java:102)
    at org.jf.dexlib.Code.Instruction.write(Instruction.java:57)
    at org.jf.dexlib.CodeItem.writeItem(CodeItem.java:258)
    at org.jf.dexlib.Item.writeTo(Item.java:117)
    ... 12 more
    code_item @0x1a6ef4 (Landroid/opengl/GLErrorWrapper;->glFramebufferRenderbufferOES(IIII)V)
{% endhighlight %}

APKTOOL 2.0针对Android 5.0做了一些优化，之前只会提示`method index is too large.`，现在会提示出已有的函数索引数量(本例中是`67380`)

为什么反编译(apktool decode)正常，回编译(apktool build)却会出现函数太多了？这一般是一些适配工具的自动化处理导致的，使用`类patchrom(由patchrom衍生出的一些ROM适配工具)`的适配工具时，
可能会往框架层代码(framework.jar, services.jar等)中添加一些扩展的逻辑，新增了很多代码，就导致回编译时函数超过限制了。

**解决方案**

在Android 5.0以下的版本，我们通常可以看到厂商会对framework.jar进行拆分，譬如secondary_framework.jar, framework2.jar, framework_ext.jar等。反编译这些拆分的jar包，就可以发现里面
其实本来就应该是framework.jar的代码，不过由于函数数量的限制，需要通过拆分的方式来解决。

在Android 5.0以上的版本，不是通过拆分jar包的方式来解决函数超容的问题，而是通过拆分dex包。所以，我们基本看不到secondary_framework.jar这种东西了，取而代之的是framework.jar里面会有
`classes.dex`和`classes2.dex`。APKTOOL 2.0在处理这种拆分dex的jar包，会逐个处理里面的dex包，反编译后的目录有`framework.jar.out/smali`和`framework.jar.out/smali_classes2`
    
知道了jar包和dex包拆分原理后，就容易解决这类问题了，我们只需要将部分目录拷贝到另一个目录就行了。以拆分dex为例，如果`classes.dex`超容了，我们可以将framework.jar.out/smali/android/widget
拷贝到framework.jar.out/smali_classes2目录。同理，如果`classes2.dex`，我们可以从framework.jar.out/smali_classes2目录拷贝一些文件到framework.jar.out/smali目录。

**延伸知识**

1. 为什么只有framework.jar要拆分，services.jar, android.policy.jar等没有拆分过？ 
   因为framework.jar里面的函数本来就很多了，随便加一点，就超容了。而其他jar包里面的函数还比较少。

2. 拆分framework.jar不会对功能造成影响吗？
   不会。因为Java都是根据类名来加载一个类的，这里说的类名是包含命名空间的，譬如`ActivityManager`，它的类名是`android.app.ActivityManager`。无论怎么挪动，只要类名正确，那这个类就能被找到。
   
3. 拆分framework.jar后，需要修改`init.rc文件里面的BOOTCLASSPATH`吗？
   诸如framework.jar, services.jar都是在Android起机的时候被一次性加载的，它们作为Android框架的核心功能，支撑了Android的所有其他模块。BOOTCLASSPATH就定义了一些开机加载的核心组件，在Android 5.0
   以下的版本，由于会多一个jar包(secondary_framework.jar等)，所以需要将这个jar包添加到BOOTCLASSPATH中。但Android 5.0更为先进，仅仅是拆分了dex包，所以不再需要针对framework拆分来修改BOOTCLASSPATH。

   
***

## 分配的system空间不足

**错误提示**

{% highlight console %}
$ make_ext4fs -s -l 537919488 -a system /tmp/tmpddYzrZ /tmp/targetfiles-KWw86n/system
Creating filesystem with parameters:
Size: 537919488
Block size: 4096
Blocks per group: 32768
Inodes per group: 6576
Inode size: 256
Journal blocks: 2052
Label:
Blocks: 131072
Block groups: 4
Reserved block group size: 39
error: do_inode_allocate_extents: Failed to allocate 109 blocks
{% endhighlight %}

**出错原因**

Android最终在编译system.img的时候，会使用`make_ext4fs`这个工具，它将一个本地的system/目录打包成system.img
打包时，需要给出预订的system.img的大小，由`-l`参数指定，本例中，给定的值是`537919488`。

如果打包后的system.img超出预先分配的大小,就会提示`Failed to allocate xxx blocks`，导致无法成功打包system.img.

**解决方案**

在编译整个系统的情况下，我们无法单独中断到`make_ext4fs`这条命令来修改`-l`参数。Android是预先将这个参数写到`META/misc_info.txt`这个文件中的：

{% highlight text %}
recovery_api_version=3
fstab_version=1
blocksize=0xffffffff
boot_size=0x800000
recovery_size=0x800000
system_size=0x20100000
userdata_size=0x40100000
extfs_sparse_flag=-s
tool_extensions=.
default_system_dev_certificate=build/security/testkey
use_set_metadata=1
multistage_support=1
update_rename_support=1
fs_type=ext4
{% endhighlight %}

`system_size=0x20100000`这一行，就指定了预先分配给system.img的大小，十进制的值就是`537919488`，只需要将这个值改大到可以正常打包system.img的大小即可。
