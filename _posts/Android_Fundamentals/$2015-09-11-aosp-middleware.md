---
layout: post
category: Android系统原理
title: AOSP中间件实践方案
tagline:
tags:  [Middleware]
---
{% include JB/setup %}

# 1. 现状和问题

**首先**，我们来看一下**Settings**和**Mms**两个Apk在编译配置时，额外引入的一些系统资源：

*Settings*额外引入了以下资源：

    MeizuCommon/src
    MeizuCommon/res                      
    MeizuWidget/MeizuToolTips/src
    MeizuWidget/MeizuToolTips/res

    ColorTheme/ColorTheme-DodgerBlue/src 包含了一个并不存在的目录
    ColorTheme/ColorTheme-DodgerBlue/res
    ColorTheme/ColorTheme-Tomato/src     包含了一个并不存在的目录
    ColorTheme/ColorTheme-Tomato/res

    flyme-res/res-meizu-common/res

*Mms*额外引入了以下资源：

    MeizuCommon/src
    MeizuCommon/res

    ColorTheme/ColorTheme-LimeGreen/src  包含了一个并不存在的目录
    ColorTheme/ColorTheme-LimeGreen/res
    ColorTheme/ColorTheme-Tomato/src     包含了一个并不存在的目录
    ColorTheme/ColorTheme-Tomato/res

    flyme-res/res-meizu-common/res

这只是两例，实际上大部分APK都会引入相同的资源，甚至会引入一些并不存在的源码目录。
单个应用其实并不关心引入额外资源的最小集是什么，仅仅关心引入进来的资源能够正常使用，哪怕是最大集或是引入一些不存在的目录也没有关系。

**然后**，我们来看一下APK如何使用这些系统资源。

APK将SDK和flyme-res目录下的资源包含到自己编译产出中，通过AAPT的**--extra-package**参数，生成了多个资源的包名，
譬如：*com.meizu.common, com.meizu.tooltips， com.meizu.colortheme_limegreen， com.meizu.colortheme_tomato*等。
APK在编译时，会生成多个 **R.java**， 只是包名不同而已，内容是一样的，即可以通过引用任何一个包名下的 **R** 来访问到相同的资源。

    Settings
    ├── com
    │   ├── android
    │   │   └── settings
    │   │       └── R.java
    │   └── meizu
    │       ├── colortheme_dodgerblue
    │       │   └── R.java
    │       ├── colortheme_tomato
    │       │   └── R.java
    │       ├── common
    │       │   └── R.java
    │       └── tooltips
    │           └── R.java


如此一来，APK在使用这些额外资源时，完全不需要区分资源的包名。譬如，Settings.apk通过 *com.android.settings.R* 引用了本该属于 *MeizuCommon/res* 目录下的资源，
某一天 *MeizuCommon/res* 目录下的资源发生了变化(这是经常出现的场景)， 那Settings.apk就晕菜了，APK代码一行没改，明明是通过 *com.android.settings.R* 引用的自己的资源，
怎么一下就找不到了呢？

**--extra-package**的使用是有特定场景的，如果不了解这些场景，则会造成APK滥用资源的包名。目前，APK使用SDK公共资源有以下几种方式：
com.meizu.common.R, com.meizu.tooltips.R, com.meizu.colortheme_xxx.R，这些资源的包名在APK中基本是混用的，给后续维护和移植带来了困难。

> **题外话**：AOSP也有很多**-extra-package**的使用案例，譬如[packages/apps/Dialer](https://android.googlesource.com/platform/packages/apps/Dialer/+/master)
> 会静态打包IncallUI的代码和资源，所以通过**--extra-package**指定了 com.android.incallui 包名，但在Dialer的代码中，并不会通过 com.android.incallui.R 的方式来引用自身的资源(虽然完全可以这么做)。
> 为什么要指定**--extra-package**参数呢？因为IncallUI的代码中有对 com.android.incallui.R 的引用，如果没有指定**--extra-package**，这些代码打包到Dialer中就会引发编译错误。


**最后**，我们分析一下，APK静态包含SDK和flyme-res目录下的资源对整个系统而言，存在的问题(按影响程度排序)：

- **APK的大小**
    
  - 以下资源都静态打包到APK里面，增加了APK的大小。而且，当这些资源增加`1K`， 那整个系统镜像的大小就会增加`nK`， **n** 为引用共用资源的APK的数量。

        res-meizu-common                1.3M
        MeizuCommon/res                 650K
        MeizuWidget/MeizuToolTips/res   30K
        ColorTheme                      230K/each

  - 虽然，AAPT的**--preferred-density**和gradle的**density split**机制能够去除掉一些无用分辨率的资源，但仍然会有很多冗余资源存在于APK中。
    在flyme_base的Nexus5上，通过工具去除掉冗余资源，能够将system分区瘦身约 **100M**

- **编程的困惑**

  - 编译配置容易造成困惑，究竟包含哪些个才是最正确的选择？
  - 通过不同的包名都能访问到相同的资源，那么，资源究竟是在APK的目录，还是在系统的目录？

- **升级的烦恼**

  - SDK有代码更新时，即便APK没有任何源码改动，也需要编译出一个新版本的APK。
  - 目前，我们的部分APK编译是独立于系统编译的，这就意味着一段时间内，APK的版本可能并非最新的。
    当我们做版本移植的时候，很可能已经有了最新的SDK代码，但仍然用的是旧的APK，无疑增加了调试成本。

- **运行的性能**


# 2. 解决方案

解决方案需要达到以下目标：

**1. APK使用资源应该简单明确。** 对于任何一个资源，应用都应该能够明确资源属于哪个包名。即便有**--extra-package**这种AAPT参数的影响，对于应用自身的资源，都应该通过应用自身的包名来访问; 对于非应用自身的资源，都应该通过资源所属的包名来访问。

**2. APK伴随系统发布时动态依赖SDK，APK独立发布时静态依赖SDK。** 对于单个APK而言，都希望是一个版本能够在不同的平台上运行，部分APK还有发向第三方市场的需求。但对从整个系统来讲，应该做到尽量精简高效，一个完整的系统版本，大部分APK应该是动态依赖于SDK的。

整体的方案框架图如下所示：

<div align="center"><img src="/assets/images/aospmiddleware/1-aospmiddleware-overview.png" alt="AOSP中间件框架图"/></div>

在深入具体的方案之前，先介绍两个技术**AAR Format(Android Archive)**和**AAPT Shared Library**。

## 2.1 Android AAR

在Android中，基于Java的库文件**JAR**很常见，譬如framework.jar, android-support-v4.jar，它们可以被一个应用程序静态或动态引用，静态引用是指APK**编译时**打包库文件，这会额外增加APK的大小; 动态引用是指APK**运行时**加载库文件，这需要保证库文件在APK的运行环境中。然而， **JAR**并不能打包Android的资源文件，所以，Android又引入了新的库文件**AAR**，不仅可以像**JAR**一样打包源代码，而且可以打包Android的资源。从某种程度上说，**AAR**就像一个APK一样，有自己的AndroidManifest.xml，可以有assets和NDK 库文件(.so)，可以自行定制混淆。与APK不同的是，**AAR**中的代码和资源可以被其他APK所用。

> **题外话**：我们编写APK时，从未见过任何地方申明要动态引用framework.jar，但实际上，每个APK都是动态依赖于framework.jar的，Android是如何做到的呢？<br/>
> 因为所有APK进程都是Zygote的子进程，在Zygote中，就已经加载过framework.jar了，同样的还有android.policy.jar, services.jar等，这些都是通过BOOTCLASSPATH环境变量设置的。<br/>
> 在Linux中，fork出来的子进程继承了父进程的地址空间，如此一来，每一个应用程序程序的运行环境中就都有framework.jar了，不必再重新加载。

**AAR**也是一个Zip压缩包，通常文件后缀名为**.arr**，它包含以下内容：

    AndroidManifest.xml (mandatory)
    classes.jar (mandatory)
    res/ (mandatory)
    R.txt (mandatory)
    assets/ (optional)
    libs/*.jar (optional)
    jni/<abi>/*.so (optional)
    proguard.txt (optional)
    lint.jar (optional)

可以参见[编写和使用**AAR**的文档](https://www.jetbrains.com/idea/help/sharing-android-source-code-and-resources-using-library-projects.html)，
笔者写了一个使用示例: <https://github.com/duanqz/AndroidLibraryDemo>

目前，gradle的com.android.library插件支持编译出一个**AAR**包，但Android的编译系统还不支持，即无法通过Android.mk编译出一个**AAR**。

## 2.1 Shared Library

**AAR**支持共享资源，但目前只支持将**AAR**静态打包到需要使用共享资源的目标应用中去，即APK无法动态引用**AAR**中的代码和资源。如何做到对代码和资源的动态引用呢？ Lollipop引入了**Shared Library**机制。

**Shared Library**的包结构与一个普通APK完全一样，其Android.mk的编译配置也与普通APK及其相似，不过需要多指明一个AAPT参数 **--shared-lib**， 用来表示当前编译出的模块是一个**Shared Library**。
编译产出就是一个**.apk**文件,作为一个库文件存在，将代码和资源共享给多个其他APK使用。

以下是一个**Shared Library**的Android.mk示例：

{% highlight makefile %}
LOCAL_PATH:= $(call my-dir)
include $(CLEAR_VARS)

LOCAL_SRC_FILES := $(call all-subdir-java-files)

LOCAL_AAPT_FLAGS := --shared-lib
LOCAL_PACKAGE_NAME := SharedLibrary

LOCAL_EXPORT_PACKAGE_RESOURCES := true
LOCAL_PRIVILEGED_MODULE := true
LOCAL_MODULE_TAGS := optional

LOCAL_PROGUARD_FLAG_FILES := proguard.proguard

include $(BUILD_PACKAGE)
{% endhighlight %}

使用共享资源的应用，只需要引用**Shared Library**库文件即可，应用中并不需要静态打包**Shared Library**。Android源码中提供了**Shared Library**的使用示例：
<https://android.googlesource.com/platform/frameworks/base/+/master/tests/SharedLibrary/>

目前，只有Android.mk支持编译出一个**Shared Library**的APK包，但gradle并没有插件支持(当然，我们可以自行定制一个插件)，这与**AAR**正好相反，导致的结果就是：
如果需要编译**AAR**，就需要用gradle; 如果需要编译**Shared Library**， 就需要用Android.mk。

## 2.3 关于共享资源

在Android中，共享Java类不足为奇，只要让类加载器找到被共享的类名就可以了，然而，资源的共享却并不是那么容易，需要有一套资源共享机制。

一般而言，APK所使用的资源由两部分组成：自身资源和系统资源。AAPT对资源进行编译以后，会生成一个 **R.java** 文件，供APK编程时使用。
在写代码时，通过**[PackageName].R.[ResourceType].[ResourceName]**来引用具体的资源，
譬如**com.android.settings.R.string.app_title**表示引用Settings.apk自己的资源，**android.R.string.ok**表示引用系统的资源。
虽然还是通过资源名称的方式来引用资源，但实际上使用的是个整数值，叫做资源ID。**R.java**维护了资源名称到资源ID的一一映射。Android将系统资源全都编码成0x01打头，APK自身的资源都编码成0x7f打头。
使用资源ID来索引资源，明显比使用字符串来查找资源要高效得多。

默认情况下，所有的资源ID都是Java常量(**public static final**类型)，这就意味着，资源ID一旦决定就无法再改变了。这些常量的资源ID会编译到APK的字节码中去，APK运行时，就是通过这些固定的资源ID来查找资源。
那么，问题来了：

- 系统资源为常量，那么基于Android Kitkat的SDK编写的应用程序要运行到Lollipop上，只能要求Lollipop上对应的系统资源ID与Kitkat完全一样，否则，通过资源ID会在Kitcat和Lollipop上访问到不同的资源。
  Android是通过什么手段来保证不同版本的系统资源ID都是同一常量呢？

- APK的资源ID为常量，那一个APK的资源是没有办法共享给其他APK用的。因为，不同APK的资源ID可能相同，但资源可能完全不同，在一个APK中 **0x7f00ca** 对应的资源与另一个APK中 **0x7f00ca** 对应的资源显然不能保证是一样的。
  这样以来，就没有办法通过常量的资源ID来访问其他APK中的资源，但Android确实又提供资源共享技术(**AAR**)，这又是如何做到的呢？

### 2.3.1 系统资源的共享

关于系统资源的共享，Android使出的方案是使用[frameworks/base/core/res/public.xml](https://android.googlesource.com/platform/frameworks/base/+/master/core/res/res/values/public.xml)来固定住系统资源的ID，
限定后续版本不能改变已有的资源ID。如果有新增的系统资源，则只能在现有的资源ID后累加。

之所以叫**public**，就是公开给APK用的，与之对应的，还有**private**，Android又叫做**internal**。Android只保证在[frameworks/base/core/res/public.xml](https://android.googlesource.com/platform/frameworks/base/+/master/core/res/res/values/public.xml)定义的资源ID是固定不变的，并建议不要使用**internal**的资源，否则会存在兼容性问题，因为不同的Android版本，**internal**的资源ID是会发生变化的。

> **题外话**：我们在Android源码中，经常可以看到通过**@hide**注解修饰的类或方法，还有**com.android.internal**命名空间下的类和资源，对于基于Android SDK开发应用而言，这些东西是不可见的，
> 因为Android在编译SDK时，会屏蔽**@hide**和**internal**的内容。之所以这么做，是有原因的：<br/>
> **@hide**意味着Android还在做验证，还没有达到稳定性或兼容性的要求，当前SDK版本不宜发布。但一旦**@hide**的内容通过验证，Android是有可能在新的SDK中发布这些内容。<br/><br/>
> **internal**意味这Andrioid并没有在SDK中公开的打算，或者说，应用开发不需要关注**internal**的内容，它更多的是Android的一些内在运行机制，譬如services之类的。

Android出于兼容性的考虑引入**public.xml**这种机制，其实也就限定了SDK只能由Android官方来发布。如果某厂商扩展了一些Android的系统资源，并在**public.xml**新增了一些资源ID，那对不起，第三方应用都不能用这些public的资源，否则，就无法兼容其他厂商的Android版本。当Android官方新版本的**public.xml**一出，所有厂商的**public.xml**都得服从，否则就背离了Android生态。所以，在Android这种霸道的设计下，厂商要出一套自己的资源SDK，是不可能的。
这也是为什么目前我们看到市场上的各种所谓SDK(其实就是**JAR**包)都与资源无关。

### 2.3.2 应用资源的共享

在应用的资源ID为常量的情况下，应用资源共享是不可能的。怎么做呢，资源ID不为常量不就行了吗？如果不为常量，就意味着应用的资源ID可以再发生改变，当共享给其他应用时，只需要改变资源ID就能避免跟已有应用资源ID的冲突。
Android正是这么做的。

上文说过，所有资源文件都会经过AAPT这个过程，生成一个 **R.java** 文件，作为资源名称到资源ID的映射表，默认情况下，资源ID为常量。其实，AAPT提供了参数**--no-constant-id**，带上这个参数，资源ID就变成了不是常量了。
对于**AAR**而言，可以共享资源，那么，它的资源ID就不应该是常量。

眼见为实，解压编译产出的**.aar**文件，打开**R.txt**文件，就可以看到资源ID了，以[笔者编写的**AAR Demo**](https://github.com/duanqz/AndroidLibraryDemo/AndroidLibrary)为例：

    int string app_name 0x7f020000
    int string shared_string 0x7f020001

**Shared Library**可以共享资源，可想而知其资源ID不是常量。AAPT的参数**--shared-lib**，隐含的意思就是**--no-constant-id**。

## 2.4 实现技术

了解了**AAR**和**Shared Library**以及Android共享资源的原理，我们就可以来探讨更为细节的实现方案。主要涉及到以下两点：

- SDK编译出两个版本：

  - 通过Android.mk编译出**Shared Library**
  - 通过gradle编译出**AAR**


- 应用通过编译选项来控制动态依赖于**Shared Library**或静态依赖于**AAR**

  - 对于整个系统发布而言，应用动态依赖于**Shared Library**
  - 对于独立市场发布而言，应用静态依赖于**AAR**

### 2.3.1 SDK的编译

实际上，更为合适的叫法应该是framework extension，像是一个架在AOSP framework之上的中间层。