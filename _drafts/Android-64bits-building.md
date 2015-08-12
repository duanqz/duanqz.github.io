---
layout: post
category:  Android
title:
tagline: ""
tags:  []
---
{% include JB/setup %}

## 

http://www.guokr.com/question/499840/

64位Android只能由Google来干。SOC厂商、手机厂商或个人几乎不可能完成。以64位ARM为例，原因可以归纳为几点：

1、首先是工具链的问题。目前googlesource上的ARM工具链源码已经更新到了gcc4.8，自行编译的话是可以支持AArch64的，但是NDK的release只能由google去做。

2、光有工具链还不行，还需要有64位的C标准库（libc、libm、linker等）。目前Android里的C标准库就是Google的bionic项目。bionic目前还没有64位版本，而且里面有大量架构相关的代码和书写形式，移植到64位困难重重。

3、最关键的一点，Android里的虚拟机Dalvik，无论是解析器还是JIT编译器，目前都没有64位target的支持。

4、假如有SOC厂商肯花费人力物力把64位的Dalvik虚拟器做出来（相当于设计一个新的解析器和JIT编译器后端），又有新的问题：很多APK采用了Native JNI，而目前Native JNI都没有AArch64的，而按照ARMv8的规范，AArch64是不支持与A32/T32做interworking的，换句话说，同一进程只能32位或64位模式之一。引入的新问题就是，虚拟机必须要同时支持两种target，使得所有Android相关的库都得编译两个版本，再结合到Dalvik VM如何从Zygote中fork出来，你就算自己能解决也没用，最终必须听Google的。

5、还有一些其它部分例如跑Javascript的V8引擎，也是没有AArch64的target的。

6、Linux kernel倒是问题不大，K3.8以后加入了AArch64的支持。但这部分也只能由SOC厂商解决，因为涉及到了SOC的各种驱动。终端厂商是无能为力的。