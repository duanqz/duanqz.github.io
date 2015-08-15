---
layout: post
category: Android系统原理
title: 编译系统(1)-概览
tagline: 
tags:  [编译系统]
---
{% include JB/setup %}

# 1. 概要

编译，就是将高级语言转换成机器语言。譬如，通过gcc将C语言编译成可以运行的二进制;通过javac将Java语言编译成可以在Java虚拟机上可以运行的字节码。

对于简单的项目，源文件数量较少，通常只需要几条命令，组织一下源文件，调用一下编译器，生成一个可以运行的文件，就算是一个“编译系统”; 但对于大型的项目，文件数量很多，通常会被组织成众多的模块，模块之间构成依赖关系，这就不是简单几条命令就能够成为“编译系统”了。一个大型项目的编译系统，需要管理好各个模块的依赖关系，组织好大量的编译中间产物，具备随时应对模块变更的扩展性，同时，也能够高效的完成编译任务。

在Linux上，一些传统大型项目的编译系统都是基于**make**这个工具，**make**并不是编译器，仍然需要调用gcc或javac等编译命令来对源码进行编译，**make**的输入是一个**Makefile**文本文件，**make**只是按照**Makefile**文件中定义的规则来完成工作。所以，这些编译系统中最核心的就是**Makefile**定义的编译规则和编译顺序，包括：哪些源文件需要编译、如何编译、哪些文件存在对其他文件的依赖，优先编译哪些文件。同其他编程语言一样，**Makefile**也有自己的语法，当正确书写完**Makefile**文件后，通过一个**make**命令，就能**自动**完成大型项目的编译。

Android编译系统也是基于**make**的，要编译出整个Android系统的镜像文件并打包成刷机包(OTA Package)，编译出SDK和文档(JavaDoc)，同时，Android引入了很多第三方开源项目，需要兼顾不同模块的编译，仅仅是这些就已经够让Android编译系统受苦了，还别提支持不同设备厂商的硬件类型，方便设备厂商进行定制这些兼容性、扩展性、编译效率的问题。Android编译系统的复杂度可见一斑，纵观整个编译，除了大量的编译规则文件(**Makefile**文件片段)，还有很多Shell和Python脚本组织在一起，基于**make**，但又不同于已有传统项目的编译系统，Android有自己的一套编译机制。

本文会分析以下问题：

> Android编译系统的设计背景是什么？ 这涉及到Android编译系统设计的意图。<br/>
> Android编译系统的设计原理是什么？ 这涉及到Android编译系统运转的内在机制。<br/>

# 2. 背景

## 2.1 Makefile规则的基本形式

**Makefile**文件的书写规则，不是本文要讨论的内容，但是**Makefile**规则的基本形式还是有必要在这里点出来，作为后续分析的理论基础。

{% highlight makefile %}
# 规则语法                                  # 示例
TARGET... : PREREQUISITES...               main.o: main.c main.h
    COMMAND 1                                  gcc -c main.c
    ...                                        ...
    COMMAND N                                  echo "Compile finished"
{% endhighlight %}

- **TARGET**： 表示当前规则要达成的目标，通常为最终生成的文件，或者为了最终生产的文件而产生的中间文件。譬如示例中的 *main.o* 就是一个中间文件
- **PREREQUISITES**： 表示当前规则所依赖的前提条件，只有前提条件满足了，才能够生成目标。这些前提条件通常为另外的规则所定义的目标，这就决定了编译顺序，只有优先编译完所依赖的目标，才能编译当前规则所定义的目标。譬如示例中所依赖的的 *main.c* 和 *main.h* 两个文件都必须存在，才能开始编译 *main.o*
- **COMMAND**： 表示当前规则的执行命令。一个规则下，可以有多条命令。当所依赖的条件满足后，就会依次执行这些命令序列，譬如调用gcc、文件拷贝、输出日志等

复杂的**Makefile**规则，都是由若干基本的规则组合而成。最终，**Makefile**会被解析成一个有向无环图(Directed Acyclic Graph, DAG), 每一个目标(Target)构成DAG的节点，每一个依赖关系(Dependency)构成DAG的边。

## 2.2 Resurvise Make的缺陷

同所有基于**make**的编译系统一样，Android也需要**Makefile**文件来定义编译规则和编译顺序。但与大多数编译系统不同的是，Android并不是**Recursive Make**的，那么什么是**Resursive Make**呢？

> 当在**Makefile**文件中，使用**make**命令来编译另一个模块时，就构成了**Resurvise Make**。<br/>
> 对于一个大型项目而言，可以为每个子系统构建一个**Makefile**文件，然后在最顶级的**Makefile**文件中，调用**make**命令来编译各个子系统: <br/>
> &emsp;&emsp; subsystem: <br/>
> &emsp;&emsp;&emsp;&emsp; cd subdir && make <br/>

**Resurvise Make**的设计能够降低编译的复杂度，更容易理解和维护，很多Linux上的大型项目，包括Linux内核的编译系统，都是采用的**Resurvise Make**设计，但Android并没有采用，因为这种设计存在很多缺陷。早在1997年，*Peter Miller*就在[Recursive Make Considered Harmful](http://aegis.sourceforge.net/auug97.pdf)这篇论文中，指出了**Resurvise Make**会导致编译系统“做得太少(do too little)”或“做得太多(do too much)”，
“do too little”会导致最终编译产物可能是错误的结果，而“do too much”会导致编译效率下降。

TODO：补充**Resurvise Make**缺陷的示例

## 2.3 Android编译系统的设计意图

由于**Resurvise Make**的缺陷，Android采用了**Non-Resursive Make**的方式，将所有的编译规则集中于一个Makefile中，可以想象最终成型的这个Makefile是极其庞大的。
为了提升编译效率和灵活性，需要对模块的编译进行控制：单个模块可以单独进行编译，不需要的模块不会被重新编译，以便节省编译时间。

在上述意图的驱使下，Android编译系统有以下主要的要求
(更详细的要求，请查阅[build/core/build-system.html](https://android.googlesource.com/platform/build/+/master/core/build-system.html)
)：

- **编译出多种目标**: 除了最终Android系统的产物(譬如：system.img, boot.img)，编译系统还要能够编译出很多实用的工具(譬如：aapt, adb)，这些工具不仅是编译环境需要的，也是开发者需要的。

- **支持多平台**： Android需要在Linux和Mac上进行编译，编译产出也需要支持Linux和Mac。编译系统对Windows的支持并不好，但面向开发者的SDK是支持Windows的。

- **Makefile片段化**：最终的规则集中于一个**Makefile**，并不意味着编译系统会维护这么大一个**Makefile**。为了提高代码的重复利用率，编译系统包含很多**Makefile片段**，最终通过**include**将片段包含进来。
每一个待编译的模块都会有一个**Android.mk**，其内容也是**Makefile**片段。

- **自动构建依赖**: 模块之间依赖关系是自动构建的，这意味着，我们只需要使用编译系统提供的接口，定义一个模块的编译规则，不需要关心编译系统如何管理众多模块之间的依赖关系。

**至此，我们分析了Android编译系统重新设计的背景，主要是为了避免Resursive Make存在的缺陷，同时应对多模块多平台的高效率编译需求。**

# 3. 设计原理

在Android源码的根目录有一个**Makefile**文件，有效内容只有一行：

{% highlight makefile %}
include build/core/main.mk
{% endhighlight %}

所有的编译规则都定义在[build/core/main.mk](https://android.googlesource.com/platform/build/+/master/core/main.mk)文件中，最终所有的**Makefile**片段都将汇聚在这一个文件中。

Android编译系统如此强大，要变成**Makefile**的最终形态，当然是要经过很长一段路的，下图是整个编译系统的框架：

<div align="center"><img src="/assets/images/buildsystem/1-buildsystem-architecture.png" alt="编译系统的框架"/></div>

我们会基于这个图来分析整个Android编译系统的设计原理：

- 从Android源码来看，编译系统的核心功能位于**[build/core/](https://android.googlesource.com/platform/build/+/master/core)**目录，
  在device和vendor目录下，存放了与具体机型相关的配置，这些配置信息都是**.mk**文件的形式存放的(譬如**BoardConfig.mk**和**AndroidProducts.mk**)，
  另外，每一个模块的编译配置信息都是以独立的**Android.mk**文件的形式分散在各个模块的子目录中。

- 编译系统需要经过初始化(setup)来完成必要的参数赋值。初始化的操作命令很简单，但实际要配置的参数是非常多的，Android支持不同平台上不同产品，甚至是不同模块的编译，
  也支持编译SDK以及PC上一些常用的工具，编译系统通过配置信息的指导，来完成具体的编译任务。

- 每一次的编译任务，就是给**make**一个**Makefile**文件，所以，每次编译任务，编译系统就会经过汇集众多零散**Makefile**片段的过程。编译整个工程和编译一个模块，最终
  汇集成的**Makefile**是不一样的，这样就能做到灵活对各个模块进行编译。

- Android将编译产物都放到了*out/*目录下，*out/*目录下又有*host/*和*target/*两个子目录，分别表示PC上和手机上的编译产物。

接下来，我们就来进一步分析编译系统的设计细节。

## 3.1 编译系统的初始化

要使Android编译系统运转起来，首先需要经过初始化，其实就是完成所有参数的配置。Android编译系统的配置，可以分为四个层级，从下到上依次是：结构级(Architecture)，芯片级(Board)，产品级(Product),模块级(Module)

<div align="center"><img src="/assets/images/buildsystem/2-buildsystem-config-levels.png" alt="编译系统的配置层级"/></div>

- **芯片级(Architecture)**：涵盖CPU体系结构和指令集的配置，譬如arm, x86, mips

- **平台级(Board)**：这个层级的配置通常定义在**BoardConfig.mk**，包括内核、驱动、CPU等与硬件紧密相关的

- **产品级(Product)**: 这个层级的配置通常定义在**AndroidProducts.mk**，包括产品名称、需要包含哪些模块和文件等

- **模块级(Module)**： 这个层级的配置都是由**Android.mk**定义的，模块具体的一些配置，包括模块名称、模块类型、对其他模块的依赖等。
  要知道Android一共有多少个模块，可以在AOSP的源码根目录下执行以下命令：

{% highlight console %}
$ find . -name Android.mk | wc -l       # 笔者在Android 5.0.1下执行这个命令，得到的结果是3868，汗！
{% endhighlight %}

这几个层级的配置并非独立的，而是在不同参数配置下相互影响的。Android提供两种方式来进行参数配置：运行*envsetup.sh*或配置*buildspec.mk*

- **运行envsetup.sh**

  Android提供了一个环境初始化的脚本[build/envsetup.sh](https://android.googlesource.com/platform/build/+/master/envsetup.sh)，
  通过*source*命令，便可以将该脚本添加到shell环境中。接着，便发现多了一个**lunch**命令，我们就是通过这个命令来配置Android初始化的参数。
  除了**lunch**，还会有很多其他命令，譬如: m, mm, mmm，我们会在[编译系统(2)-初始化过程]()这篇文章中来详细介绍*envsetup.sh*的工作过程。

{% highlight console %}
$ source build/envsetup.sh  # 将envsetup.sh添加到shell执行环境中
$ lunch                     # 通过lunch来交互式的完成参数配置
{% endhighlight %}

- **配置buildspec.mk**

  该文件需要置于Android源码的根目录，Android提供一个配置模板[build/buildspec.mk.default](https://android.googlesource.com/platform/build/+/master/buildspec.mk.default)，
  只需要将拷贝到根目录，重命名后，根据需要修改文件内容便可完成参数的配置。
  
  **注**：支持这种文件配置的方式来完成初始化，是考虑到有些固定的编译场景，不需要每次都重复运行**envsetup.sh**脚本来配置相同的参数。

### 3.1.1 产品级(Product)的参数配置

无论是采用哪种方式，都会涉及到以下几个重要的参数：

- **TARGET_PRODUCT**：目标产品。这个参数的取值来自于一个具体产品的定义，通常位于**device/[manufacture]/[product]**下的**AndroidProducts.mk**文件中，
  通过**PRODUCT_MAKEFILES**这个属性来汇集所有产品级别的配置，包括产品名称**PRODUCT_NAME**，产品品牌**PRODUCT_BRAND**等。产品名称**PRODUCT_NAME**实际上就对应到了**TARGET_PRODUCT**。
  
  Android 5.0.1提供了一些默认的目标产品：aosp_arm、aosp_arm64、aosp_mips、aosp_mips64、aosp_x86、aosp_x86_64，分别表示arm, mips, x86上32位和64位的产品类型。
  到Android实际支持的机型，就有aosp_hammerhead, aosp_manta,分别表示LGE Nexus 5和SAMSUNG 4S。

- **TARGET_BUILD_VARIANT**：目标产品的版本。每一个模块都可以通过**LOCAL_MODULE_TAGS**这个参数来标记自己，可选的标记值有user, debug, eng, tests, optional, 或samples。
  设定目标产品的类型，就能筛选出指定标记的模块，只将符合要求的模块编译打包到最终的产品中去。
  
  **TARGET_BUILD_VARIANT**有以下取值，除了筛选模块，还有一些调试级别的差异：

  - **eng**：对应到工程版。编译打包所有模块。同时ro.secure=0， ro.debuggable=1， ro.kernel.android.checkjni=1，表示adbd处于ROOT状态，所有调试开关打开
  - **userdebug**：对应到用户调试版。同时ro.debuggable=1，打开调试开关，但并没有放开ROOT权限
  - **user**： 对应到用户版。同时ro.secure=1，ro.debuggable=0，关闭调试开关，关闭ROOT权限。最终发布到用户手上的版本，通常都是**user**

- **TARGET_BUILD_TYPE**: 目标产品的类型。只有release和debug两种取值，默认的取值为release。Android源码中包含一些调试专用的代码，当取值为debug时，这些调试代码会编译到最终的产品中去。

- **TARGET_TOOLS_PREFIX**: 编译工具链的路径前缀。默认情况下，Android使用prebuilts目录下的工具，但通过这个值也可自行定制为其他目录。

当**TARGET_PRODUCT**设定后，编译系统就可以基于它获取其他参数了。这个产品是哪个体系结构，哪个芯片，内核的命令参数是什么？
这些硬件相关的参数都是通过**BoardConfig.mk**来配置的，编译系统会搜寻device和vendor目录下的**$(TARGET_DEVICE)/BoardConfig.mk**，这样就能找到对应产品的的芯片级(Board)配置了。

### 3.1.2 平台级(Board)的参数配置

**BoardConfig.mk**文件中参数主要有以下几个类别：

- **CPU体系结构**: TARGET_CPU_ABI， TARGET_CPU_VARIANT, TARGET_ARCH, TARGET_ARCH_VARIANT等。其中一些参数的取值不同，会连带引发其他参数的不同。

- **内核参数**： BOARD_KERNEL_BASE， BOARD_KERNEL_PAGESIZE， BOARD_KERNEL_CMDLINE这些参数最终会被打包到boot分区的镜像文件中(boot.img)，作为内核的启动参数。

- **分区镜像**: TARGET_USERIMAGES_USE_EXT4, BOARD_BOOTIMAGE_PARTITION_SIZE, BOARD_SYSTEMIMAGE_PARTITION_SIZE等与分区格式、分区大小相关的参数。

- **驱动**: BOARD_HAVE_BLUETOOTH， BOARD_WLAN_DEVICE等与蓝牙、wifi硬件配置相关的参数


### 3.1.3 芯片级(Architecture)的参数配置

不同的产品(Product)配置会对应到不同的平台(Board)配置，而平台(Board)的配置也会影响到芯片(Architecture)的配置。**BoardConfig.mk**中定义的**TARGET_ARCH**和**TARGET_ARCH_VARIANT**两个参数决定了**TARGET_ARCH_SPECIFIC_MAKEFILE**这个芯片级(Architecture)的配置文件，它的值等于**[build/core/combo/arch](https://android.googlesource.com/platform/build/+/master/core/combo/arch)/$(TARGET_ARCH)/$(TARGET_ARCH_VARIANT).mk**。

Android默认定义了arm, arm64, mips, mips64, x86, x86_64这几组与CPU芯片相关的编译参数。

### 3.1.4 模块级(Module)的参数配置

Android编译系统的设计理念是将模块级别的配置独立出来，每个模块的**Android.mk**都是独立的。在编译单个模块时，会将模块的**Android.mk**添加到**main.mk**中，形成一个**Makefile**。
当然，模块的**Android.mk**必须遵循编译系统定义的规则，具体的配置细节可以参见[编译系统(4)-定制]()。这里只说明编译系统提供给模块编译的接口：

**接口变量**                   | **接口定义**            | **作用**
**BUILD_EXECUTABLE**          | executable.mk          | 编译二进制可执行文件，如adbd
**BUILD_HOST_EXECUTABLE**     | host_executable.mk	  | 编译PC上的二进制可执行文件，如aapt
**BUILD_JAVA_LIBRARY**        | java_library.mk        | 编译动态Java库文件，如framework.jar
**BUILD_HOST_JAVA_LIBRARY**   | host_java_library.mk	  | 编译PC上的Java库文件，如signapk.jar
**BUILD_SHARED_LIBRARY**      | shared_library.mk	  | 编译动态的库文件，如libfilterfw.so
**BUILD_STATIC_LIBRARY**      | static_library.mk	  | 编译静态的库文件，如libip6tc.so
**BUILD_PACKAGE**             | package.mk             | 编译APK，如SystemUI.apk


所有接口定义的源文件，都在[build/core](https://android.googlesource.com/platform/build/+/master/core/)目录下，在**Android.mk**中，只需要引用这些变量，就能触发一个模块的编译，不同的模块使用不用的编译方式。
在将一个**Android.mk**文件*include*到**main.mk**中的时候，也会依次将上述变量定义的**.mk**文件*include*进来，从而生成最终的**Makefile**配置。

## 3.2 编译系统的运行过程

编译系统的运行过程可以分为两部分：

- **合成最终的Makefile**：零散的**Makefile**片段，会按照引用关系汇集到**main.mk**中，作为最终编译的**Makefile**

- **根据依赖关系逐步构建出最终产物**：**Makefile**的编译规则最终成型为一个**DAG**，**make**会按照*"后根顺序(post-order)"*来遍历**DAG**，被依赖的目标总是先被执行

### 3.2.1 汇集Makefile零散片段

通过**Makefile**的*include*语法，就能将其他**Makefile**片段包含到当前**Makefile**文件中来，当我们在Android目录下执行**make**命令时，实际上输入文件是根目录下的**Makefile**，所有的片段最终都汇集到该文件中。

大体的汇集过程如下图所示：

<div align="center"><img src="/assets/images/buildsystem/3-buildsystem-makefile-aggregating.png" alt="Makefile片段汇集"/></div>

最终**Makefile**文件中仅仅引入了*main.mk*, *main.mk*位于*build/core*目录，望文生意，这就表示已经进入Android编译系统最为核心的部分了，*main.mk*会做编译环境检查，定义最重要的编译目标(droid)，**依次**引入其他功能片段:

- *help.mk*，最优先引入的片段，文件内容很简单，就是定义了一个名为**help**的目标，通过输入`make help`命令，就可以看到该目标的输出结果是一些最主要的**make**目标的帮助信息。
  
- *config.mk*，文件内容很庞大，目的就是为了配置编译环境。该文件定义了用于其他模块编译的常量(BUILD_JAVA_LIBRARY, CLEAR_VARS等)，也定义了编译时所依赖工具的本地路径(aapt, minigzip等)，同时也会引入与基于机型配置相关的其他片段(BoardConfig.mk, AndroidProducts.mk等)。

- *cleanbuild.mk*，定义了**installclean**这个编译目标，不同于**clean**，执行`make installclean`的时候，并不会完整的删除*out/*目录，而是仅仅删除与当前**TARGET_PRODUCT, TARGET_BUILD_VARIANT, PRODUCT_LOCALES**这属性关联到的编译产出。通俗一点来说，就是删除*out/target/product/*目录下本次机型编译的产物，*out/host*目录下的文件是保留下来的。

- *definitions.mk*，定义了大量的函数，这些函数都是编译系统的其他文件将用到的。譬如：my-dir， all-subdir-makefiles， find-subdir-files等，通过**Makefile**的*$(call func_name)*就能调用这些函数。

- *dex_preopt.mk*，为了提升代码的运行效率，Android会对可执行文件做优化，即将**dex**格式的文件转换为**odex**格式的文件。在ART虚拟机下，仍然采用**dex(Dalvik Executable)**和**odex(Optimized Dalvik Executable)**这个文件的命名方式，但实际上ART与Dalvik的文件格式是不同的。

- *Android.mk*，Android有全编译和模块编译之分：

  - 全编译，会通过[build/tools/findleaves.py](https://android.googlesource.com/platform/build/+/master/tools/findleaves.py)这个脚本将所有模块的*Android.mk*加载到一个名为 **subdir_makefiles**这个变量中，然后逐个引入**$subdir_makefiles**中的**Makefile**片段;
  - 模块编译，是通过命令解析将待编译模块的*Android.mk*文件加载到**ONE_SHOT_MAKEFILE**这个变量中，编译时，仅仅是引入**ONE_SHOT_MAKEFILE**中的**Makefile**片段。

  *Android.mk*的编写模板基本都是一致的,它会引入很多编译系统已经初始化好的变量，譬如CLEAR_VARS， BUILD_JAVA_LIBRARY, 其实就是引入变量所对应的*.mk*文件，所以*Android.mk*的生成过程，也是一个**Makefile**片段的汇集过程。

- *post_clean.mk*，在引入待编译模块后，就可以定义模块的清除规则了。该片段定义了基于上一次编译产出的清除规则，譬如，某个模块的AIDL文件或者资源发生了变化，那再次编译这个模块时，就需要清除上一次的编译产物。

- *legacy_prebuilts.mk*，定义了**GRANDFATHERED_ALL_PREBUILT**变量，表示不需要经过编译的预装文件，譬如gps.conf(GPS配置文件), radio.img(射频分区镜像文件)，这些文件都是预编译好的，只需要拷贝到编译产出即可。Android定义了一个默认的**PREBUILT列表**，而且不希望第三方改动这个列表。当第三方有预编译文件，但又不在**PREBUILT列表**中时，就需要通过**PRODUCT_COPY_FILES**这个变量来指定了。

- *Makefile*，不同于AOSP根目录下的**Makefile**，这个*Makefile*位于[build/core](https://android.googlesource.com/platform/build/+/master/core)目录下，Android官方对这个文件的解释是"定义一些杂乱的编译规则(miscellaneous rules)"，实际上，这个文件相当重要，诸如system.img, recovery.img, userdata.img, cache.img的目标定义都在这个文件中，更笼统点说，*out/target/product/PRODUCT_NAME/*目录下大部分的编译产出都是由该文件定义的。

### 3.2.2 生成Makefile目标依赖

最终**Makefile**所定义的依赖关系可以用一个**有向无环图(Directed Acyclic Graph, DAG)**来表示，如果解析**Makefile**规则，发现存在一个依赖环，那就不是合法的**Makefile**规则。

可以把编译系统构建的依赖关系分成系统级和模块级别两个层面：

- 系统级的依赖关系，是指最终编译出Android系统所涉及到的目标之间的依赖。譬如编译出system.img有哪些依赖目标需要先编译完成。这一层的依赖是由编译系统定义的。

- 模块级的依赖关系，是指各个模块之间的依赖。譬如模块A依赖模块B，那么就需要将这个依赖关系告诉编译系统，只有当模块B编译完成了，才能开始编译模块A。这一层的依赖是由各个模块单独定义的。

#### 3.2.2.1 系统级的依赖关系

最终生成的**DAG**是极其庞大的，为了说明问题，我们仅列出了一些关键的编译目标之间的依赖关系图：

<div align="center"><img src="/assets/images/buildsystem/4-buildsystem-makefile-dependency.png" alt="Makefile目标依赖"/></div>

- **droid**，是最顶层的编译目标，执行**make**命令时，就会默认编译这个目标，但这个目标并没有什么实质内容，仅仅作为所依赖目标的组合。其中**dist_files**是编译产物emma_meta.zip，主要用作测试覆盖率;
  **apps_only**这个编译目标是由**TARGET_BUILD_APPS**的值决定的，当只编译指定的app时，就会编译这个目标，否则就编译**droidcore**这个目标。

- **droidcore**，Android全编译的顶层目标，也仅仅作为所依赖目标的组合。**boot.img, recovery.img, userdata.img, cache.img, system.img**这些最终刷入设备的镜像都是被依赖的目标。

- **files**，该目标囊括所有预编译的模块**prebuilt**，需要编译安装的模块**modules_to_install**，这些模块的编译产物输出到最终需要打包的分区镜像文件中。

- **system.img**，在**Makefile**中，真正的编译目标是**systemiamge**，它依赖于**INSTALLED_SYSTEMIMAGE**这个变量，其实就是编译完成后**out/**目录下的**system.img**，
  要编译**system.img**，当然依赖于很多模块的编译产出(由**ALL_DEFAULT_INSTALLED_MODULES**变量描述的)，这里就构成了两个目标依赖于同一个目标的依赖关系，但仍然没有构成环。

- **userdata.img**, **cache.img**, **recovery.img**，这些都是分区镜像文件，最终刷入设备上对应的分区，它们都是被**droidcore**依赖的目标，当然，这些目标的生成也依赖于很多其他的目标。

- **installed-files.txt**, 一个文本文件，最终生成在**out/**目录下，文件内容列出了所有安装的模块。

这里并没有把更多的依赖细节体现出来，只是展开了几个很顶层的目标，实际上，各个目标之间的依赖关系是错综复杂的。

#### 3.2.2.2 模块级的依赖关系

每一个模块的*Android.mk*文件中，都可以通过**LOCAL_REQUIRED_MODULES**的值，来设置所依赖的其他模块，但这只是一个依赖关系的定义，对**LOCAL_REQUIRED_MODULES**的处理还是编译系统完成的。

在*Android.mk*中，都会调用编译系统提供的模板，来编译一个特定的模块，这是通过引用**Makefile**变量来实现的，譬如：**$(BUILD_HOST_EXECUTABLE)**表示编译PC机上的可执行程序，**$(BUILD_PACKAGE)**表示编译一个APK，
**$(BUILD_JAVA_LIBRARY)**表示编译一个Java库文件。

每一个**$(BUILD_XX)**的变量，都会对应到一个**.mk**文件，而这些**.mk**文件也会引用其他**.mk**文件，最终都会落到引用**base_rules.mk**中:

<div align="center"><img src="/assets/images/buildsystem/5-buildsystem-modules-dependency.png" alt="模块之间依赖"/></div>

在**base_rules.mk**中，待编译的模块会把自己添加到**ALL_MODULES**这个变量中，如此一来，当所有的*Android.mk*引入完成后，**ALL_MODULES**就记录了所有待编译的模块。
所有被依赖的模块会保存在**ALL_MODULES.$(m).REQUIRED**这个变量中，**$(m)**就是当前被引入的模块，在编译**$(m)**这个模块的时候，就会顺着**ALL_MODULES.$(m).REQUIRED**变量找到被依赖的模块，从而构建出依赖关系图。

### 3.2.3 编译产出

我们最关心的当然是一次编译能够有什么产出，所有的编译产物都在**out/**目录下，有两个子目录:**host/**表示针对PC上的产物，**target/**表示针对移动设备上的产物。所有编译产物的生成过程可以大致分为三步：

1. 各个模块编译出中间产物。这些中间产物都位于**host/**和**target/**下面的**obj/**子目录中，对于C代码而言，中间产物通常就是**.o**文件;对于Java代码而言，中间产物通常就是**.jar**文件。

   以**target/**下面的**obj/**为例，有以下类别的中间产物：

   - **EXECUTABLES**： BUILD_EXECUTABLE的中间产物，譬如adbd, app_process等模块
   - **JAVA_LIBRARIES**： BUILD_LIBRARY的中间产物，譬如framework, services等模块
   - **SHARED_LIBRARIES**： BUILD_SHARED_LIBRARY的中间产物， 譬如libart, libc, libsqlite等模块
   - **STATIC_LIBRARIES**: BUILD_STATIC_LIBRARY的中间产物，譬如libapplypatch等模块
   - **APPS**： BUILD_PACKAGE的中间产物, 譬如Browser, Email, Settings
   - **ETC**: 譬如init.rc, mac_permissions.xml, *.ttf字体文件等模块
   - **PACKAGING**: 打包时的中间文件，譬如systemimg, userdataimg, target_files, apkcerts， 这些编译目标需要打包其他编译产物
   - **lib**: 编译完成的so库，最终会按照目录结构加载到system/lib目录。

   对于**host**下面的**obj/**，也有类似的目录结构。

2. 链接各个中间产物，生成可执行的文件。对于**EXECUTABLES**，会在模块的临时目录生成一个二进制程序;对于**SHARED_LIBRARIES**，会在模块的临时目录生成一个**LINKED**的子目录，存放这最终编译完成的so库文件。

3. 打包二进制文件，生成镜像文件。譬如，将各种apk、jar和so文件拷贝到**system/**目录，打包生成**system.img**镜像。


## 3.3 编译SDK

TODO
