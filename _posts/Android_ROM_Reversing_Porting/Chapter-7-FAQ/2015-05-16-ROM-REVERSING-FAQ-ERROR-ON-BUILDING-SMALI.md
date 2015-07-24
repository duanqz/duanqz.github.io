---
layout: post
title: 常见错误(2)-Smali编译相关
category: ROM逆向适配
tagline: Smali语法相关
tags: [日志分析]
---
{% include JB/setup %}

分析常见smali语法导致的错误

# 重复定义

**错误提示**

{% highlight console %}
I: Using Apktool 2.0.0
I: Checking whether sources has changed... 
I: Smaling smali folder into classes.dex... 
out/obj/system/framework/services.jMu/smali/com/android/server/SystemServer.smali[16,8] Multiple annotations of type Ldalvik/annotation/MemberClasses; 
Exception in thread "main" brut.androlib.AndrolibException: Could not smali file: com/android/server/SystemServer.smali 
    	at brut.androlib.src.SmaliBuilder.buildFile(SmaliBuilder.java:71) 
    at brut.androlib.src.SmaliBuilder.build(SmaliBuilder.java:55) 
    	at brut.androlib.src.SmaliBuilder.build(SmaliBuilder.java:41) 
    	at brut.androlib.Androlib.buildSourcesSmali(Androlib.java:354) 
    	at brut.androlib.Androlib.buildSources(Androlib.java:294) 
    at brut.androlib.Androlib.build(Androlib.java:280) 
    at brut.androlib.Androlib.build(Androlib.java:255) 
    at brut.apktool.Main.cmdBuild(Main.java:225) 
    at brut.apktool.Main.main(Main.java:84) 
make[1]: *** [out/obj/system/framework/services.jar] Error 161 
make[1]: Leaving directory `/home/duanqizhi/source/smali-5.0/devices/g2_cm' 
make: *** [ota] Error 2
{% endhighlight %}

**出错原因**

使用apktool b回编译时，Smali语法错误。出现重复定义的错误的场景有很多，基本都与smali的语法相关，本例中重复定义了annnotations
定位到出错地方的代码片段`services.jar.out/smali/com/android/server/SystemServer.smali`的第16行，

{% highlight smali %}
# annotations 
.annotation system Ldalvik/annotation/MemberClasses; 
    value = { 
        Lcom/android/server/SystemServer$AdbPortObserver; 
    } 
    .end annotation 
 
# annotations 
.annotation system Ldalvik/annotation/MemberClasses; 
    value = { 
        Lcom/android/server/SystemServer$Injector; 
    } 
.end annotation
{% endhighlight %}

**解决方案**

发现有两个annotation MemberClasses的定义，为什么会出现两个呢？这通常是由我们的误修改导致的，使用一些自动化的工具对smali进行修改，就容易出现这种类型的错误。我们只需要将改成如下形式即可：

{% highlight smali %}
# annotations
.annotation system Ldalvik/annotation/MemberClasses; 
    value = { 
        Lcom/android/server/SystemServer$AdbPortObserver;,  # 注意，用”,” 区分多个内部类
        Lcom/android/server/SystemServer$Injector; 
    }
.end annotation
{% endhighlight %}

***

# 误用p命名寄存器

**错误提示**

{% highlight console %}
I: Using Apktool 2.0.0-RC4 
I: Checking whether sources has changed... 
I: Smaling smali folder into classes.dex... 
out/obj/system/framework/framework.ShI/smali/android/app/ContextImpl.smali[1027,4] Invalid register: v18. Must be between v0 and v15, inclusive. 
Exception in thread "main" brut.androlib.AndrolibException: Could not smali file: android/app/ContextImpl.smali 
    at brut.androlib.src.SmaliBuilder.buildFile(SmaliBuilder.java:71) 
    	at brut.androlib.src.SmaliBuilder.build(SmaliBuilder.java:55) 
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

使用apktool b回编译时，Smali语法错误。定位到出错的地方：framework.jar.out/smali/android/app/ContextImpl.smali的第1027行，第4列，内容为：

{% highlight smali %}
invoke-virtual {p3}, Landroid/app/LoadedApk;->getPackageName()Ljava/lang/String;
{% endhighlight %}

出错提示是“限定使用寄存器v0～v15,但使用了非法的寄存器v18“, 观察出错行，只使用了寄存器`p3`，并没有使用v寄存器，而且为什么限定只能使用`v0～v15`呢？

首先，我们来看，寄存器限定使用v0～v15。因为invoke操作符参数是用4-bits来存储的，最大的索引范围是16，所以限定了使用v0到v15的这16个寄存器。

其次，p命名的寄存器，是方法的形参，实际也是占用寄存器的,而且是占用的最后的寄存器,如果一个方法使用了`n`个局部变量(寄存器),那么参数使用的寄存器是从`n+1`开始的。如果n超过16了,那px也就必然超过16了，
本例中，使用了15个局部寄存器(通过函数体第一行的.local定义)，所以，p3使用的寄存器其实就是v18。

**解决方案**

有两个解决方案：

- 将超过 16 的寄存器先 move 到 16 以下的寄存器,然后使用: 

{% highlight smali %}
move-object/from16 v0, p3 
invoke-direct {v0} ... 
{% endhighlight %}

- 改用 invoke-direct/range,range系列invoke操作符参数都是用1字节(8-bits)来存的,因此能表示的范围可以达256: 

{% highlight smali %}
invoke-direct/range {p3 .. p3} …
{% endhighlight %}

***

# 误用v命名寄存器

**错误提示**

{% highlight console %}
I/art ( 5704): Explicit concurrent mark sweep GC freed 947(50KB) AllocSpace objects, 0(0B) LOS objects, 94% free, 61KB/1085KB, paused 125us total 2.685ms 

I/art ( 5704): Rejecting re-init on previously-failed class java.lang.Class<android.app.ResourcesManager> 
...

I/dex2oat ( 5833): Verification error in boolean android.app.ResourcesManager.applyConfigurationToResourcesLocked(android.content.res.Configuration, android.content.res.CompatibilityInfo) 

I/dex2oat ( 5833): boolean android.app.ResourcesManager.applyConfigurationToResourcesLocked(android.content.res.Configuration, android.content.res.CompatibilityInfo) failed to verify: register v0 has     type Undefined but expected IntegertionToResourcesLocked(android.content.res.Configuration, android.content.res.CompatibilityInfo): [0x43] 

E/dex2oat ( 5833): Verification failed on class android.app.ResourcesManager in /system/framework/framework.jar because: Verifier rejected class android.app.ResourcesManager due to bad method boolean     android.app.ResourcesManager.applyConfigurationToResourcesLocked(android.content.res.Configuration, android.content.res.CompatibilityInfo) 
{% endhighlight %}

**出错原因**

在Android 5.0上，会对jar包做dex2oat的操作，以便生成可以在ART上运行上文件格式，这个过程会对所有的smali文件进行验证(verify)。

本例中， android.app.ResourcesManager这个类出现了verify错误，所以无法加载：

    failed to verify: register v0 has type Undefined but expected IntegertionToResourcesLocked(android.content.res.Configuration, android.content.res.CompatibilityInfo): [0x43] 

在android.app.ResourcesManager.applyConfigurationToResourcesLocked()这个函数中，误用了一个寄存器v0，本来期望v0是一个整数值，但v0却没有定义(type Undefined)。
在通过`Smali插桩`代码的时候，插入的代码使用的寄存器是同上下文关联的，即v0依赖于上下文的定义；而在厂商的逻辑中，对应v0的，可能是v1或者其他寄存器变量，这完全是由厂商的代码逻辑决定的。

产生这种错误，通常也是由于插桩不细心导致的，自动化`Smali插桩`解决冲突时，如果没有观察寄存器使用的上下文，也容易导致这类错误。

**解决方案**

本例中，需打开framework.jar.out/smali/android/app/ResourcesManager.smali这个文件，定位到applyConfigurationToResourcesLocked()这个函数中，找到我们改动的地方，检查一下寄存器v0使用时的上下文依赖。
将v0改成厂商中使用的寄存器变量即可。

**延伸知识**

这种错误在支持ART虚拟机模式的版本上，特征关键字是：

    E/dex2oat：(pid)：Verification failed on ...，

在Dalvik虚拟机上，对应的错误关键字是`VFY`。
当我们的Log中出现这种关键字，就要小心了。即便只有一个类出现verify错误(会导致该类无法被加载)，也可能会导致其他类型的错误，从而无法起机。

***

**错误提示**

{% highlight console %}
I/dex2oat ( 5833): Verification error in android.content.pm.PackageParser$Activity android.content.pm.PackageParser.parseActivity(android.content.pm.PackageParser$Package, android.content.res.Resources, org.xmlpull.v1.XmlPullParser, android.util.AttributeSet, int, java.lang.String[], boolean, boolean) 

I/dex2oat ( 5833): android.content.pm.PackageParser$Activity android.content.pm.PackageParser.parseActivity(android.content.pm.PackageParser$Package, android.content.res.Resources,    org.xmlpull.v1.XmlPullParser, android.util.AttributeSet, int, java.lang.String[], boolean, boolean) failed to verify: copy1 v0<-v18 type=Undefined cat=3ctivity     android.content.pm.PackageParser.parseActivity(android.content.pm.PackageParser$Package, android.content.res.Resources, org.xmlpull.v1.XmlPullParser, android.util.AttributeSet, int, java.lang.String[],   boolean, boolean): [0x96] 

E/dex2oat ( 5833): Verification failed on class android.content.pm.PackageParser in /system/framework/framework.jar because: Verifier rejected class android.content.pm.PackageParser due to bad method     android.content.pm.PackageParser$Activity android.content.pm.PackageParser.parseActivity(android.content.pm.PackageParser$Package, android.content.res.Resources, org.xmlpull.v1.XmlPullParser, android.util.AttributeSet, int, java.lang.String[], boolean, boolean) 

I/dex2oat ( 5833): Verification error in boolean
{% endhighlight %}

**出错原因**

找到了关键字E/dex2oat：(pid)：Verification failed on ...，说明在的dex2oat的时候，verify语法检查出错了。本例的错误提示是：

    failed to verify: copy1 v0<-v18 type=Undefined cat=3ctivity

在android.content.pm.PackageParser.parseActivity()这个函数中，存在一个非法的赋值操作，可以在该函数中搜索`move v0, v18`，由于误用了寄存器v18导致的，在厂商的代码逻辑中，v18没有定义。

**解决方案**

只需打开framework.jar.out/smali/android/content/pm/PackageParser.smali这个文件，定位到parseActivity()，将误用的寄存器v18修正为厂商中对应的寄存器变量即可。

***


