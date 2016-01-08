---
layout: post
category: Android系统原理
title: GMS(Google Mobile Services)介绍
tagline:
tag: []
---
{% include JB/setup %}


`GMS`是Google针对移动终端提供的一系列服务，主要是面向于Android设备，不同于AOSP(Android Open Source Project)，GMS需要Google的授权才能使用。本文从以下问题来探讨GMS：

- 如何获取GMS授权？
- 为什么国内手机没有预装GMS？
- 如何预装GMS？

# 如何获取GMS授权

众所周知，Android由于其开源的特性导致版本众多，各厂商定制的版本甚至比Google自身的版本还要受欢迎，当年Samsung的S3大卖，足够秒杀Google的Nexus系列。虽然Google将Android开源，但并不意味着要将Android的主动权拱手想让。所以，从2013年开始，Google就针对不断分裂的Android做了一系列悄无声息的动作。

2013年9月，Google将一些服务从Android开发者官网上独立出来，称之为**GMS**，并声称这部分服务不再属于AOSP。换言之，这部分服务是不开源的。随后，Android对OEM厂商设置门槛，要求对使用**GMS**的设备进行授权和认证。彼时坊间流言四起，一则说Google要对GMS进行授权收费，一则说Google从此要将Android闭源，以收回对Android的控制权。然而，随后发生的事情并非流言所说，Google即没有对GMS进行授权收费，也没有将Android闭源。Google创造**GMS**这么一个概念，得从开放手机联盟说起。

Google于2007年联合业内知名的设备厂商、芯片厂商、移动运营商等成立了开放手机联盟(Open Handset Alliance， OHA)，联盟的成员从最初的34家变成了现在的84家，最新的成员列表可查看<http://www.openhandsetalliance.com/oha_members.html>。OHA的宗旨是打造更好的手机，第一个联合项目当然就是Android。加入OHA，意味这加入了Android的生态圈，一方面各地区的运营商更青睐推广OHA成员的手机，另一方面，加盟OHA的设备厂商也能更快的拿到最新的Android版本，先于OHA以外成员适配Android，占得市场先机。作为OHA的成员，需要遵循**Compatible Android**的约束，如何做到Android的兼容性，具体可以查阅<https://source.android.com/compatibility>，简单来说有三条：1. 使用AOSP进行适配; 2. 遵循Android兼容性定义; 3. 通过CTS(Compatibilty Test Suite)测试。满足这三条，就可以向Google申请GMS授权，Google会审查设备厂商的资质，通过Google的认证后，就能在出厂的手机中预装GMS了。

在GMS的影响下，出现了三种级别的设备：

1. 不预装GMS，这类设备通常对AOSP进行了深度定制，譬如国内的大部分手机;
2. 预装部分GMS，这类设备不能使用Google的商标，譬如Samsung的手机;
3. 预装全部GMS，这类设备可以使用Google的商标，譬如Nexus系列的手机。

GMS包虽然由Google官方提供，但也流出了一些民间制作的版本，譬如<https://s.basketbuild.com/gapps>就提供了众多Android版本的GMS包。
随着Android版本的升级，不同的GMS包的内容是有差异的，但组成结构是一样的，都是一个刷机包(以**Lollipop 5.0**的一个GMS包为例)：

    GMS-Lollipop-5.0/
    ├── META-INF	# 包含签名信息和刷机脚本
    └── system      # 安装到system分区的文件
        ├── app     # 安装到 system/app 目录
        │   ├── Hangouts
        │   ├── Gmail2
        │   ├── GoogleCalendarSyncAdapter
        │   ├── GoogleContactsSyncAdapter
        |   ...
        ├── framework  # 安装到 system/framework 目录
        ├── priv-app
        │   ├── GooglePartnerSetup
        │   ├── GoogleServicesFramework
        |   ...
        ├── lib       # 安装到 system/lib 目录

诸如Chrome，Gmail，Play，Search等应用一般都是包含在GMS包中的，只需要刷入GMS包即可。
热心的网友们也为一些不懂刷机的用户提供了一键安装GMS包的工具。

# 国内的智能手机为什么没有预装GMS

只要满足Android的兼容性要求，就能申请GMS的授权，Google设定了GMS授权的门槛，目前全球范围内也只有少数几个设备厂商具备GMS授权。
国内市场的手机没有预装GMS除了资质审查不过关的原因以外，还有以下两个原因：

- Google于2010年退出中国，因此国内没有Google提供的服务，自然也就没有GMS;
- 国内市场上出货的手机，一般都对AOSP进行了深度定制，接入了本土的服务，因此没有GMS并不影响整机的体验。

当国内一些设备厂商想要出货到海外时，没有GMS的劣势很快就显现出来了，大多数海外用户对GMS还是情有独钟的，一些深受国内用户喜欢的服务推广到海外后，并不受欢迎。当然，也有一些厂商在没有授权的情况下预装GMS，规模比较小时，Google通常都是放任不管，但当规模大到一定程度，就会受到Google的制裁。

Google通过OHA构建了Android生态圈，与Apple iOS和Windows Phone形成三足鼎立的局面。GMS的授权使用体现出Google作为一个互联网公司，宗旨还是在推行软件服务而不是硬件设备，同时也体现出了Google对Android的控制力。无论Android碎片化有多么严重，只有在Android生态圈下才能良性生存，要进入Android生态圈，就要满足Android的兼容性要求。对于设备厂商而言，进入Android生态圈，获取全球用户，最轻量的做法就是接入GMS。Google给设备厂商搭建了一条无形的路，按着这条路走，就能与Android共享繁荣。

当然，国内也有背离Android生态圈的存在，典型不过阿里的`YunOS`了，野心勃勃地想要构建同Android平行的一个生态圈。**YunOS**最初的推广手段比较简单粗暴，直接给设备厂商补贴，即设备厂商预装一台**YunOS**，就补贴一定的金额。阿里的这种勇气和决断是值得赞赏的，在硬件的盈利能力日趋下降的情况下，部分小的设备厂商也都挺乐意接受这种合作的。但对于一些瞄准海外的大的设备厂商而言，加入`YunOS`就意味着背离Android生态圈，自然不利于其海外的推广。有一些设备厂商提出了双品牌战略，即国内和国外使用不同的品牌，针对国内市场，对Android进行深度定制; 针对国外市场，积极的融入Android生态圈。

# 如何预装GMS

通过Recovery将GMS包刷入手机这种方式属于后装，即已经有了Android刷机包后，再继续刷入GMS包。
下面我们讲述一下如何在AOSP源码环境下，编译出包含GMS的Android刷机包。

> **注意**：在没有经过Google授权的情况下预装GMS等同于盗版行为，应当坚决抵制。
> 本例展示的GMS预装进作为学习用途，任何一个开发者都应该遵循"不作恶"的契约精神，这才是良性的发展之道。

预装就是要将GMS包中的文件直接编译到Android的刷机包中，AOSP的编译系统能够轻松满足预装文件的需求。

对于APK而言，只需要利用编译系统提供的**$(BUILD_PREBUILT)**脚本，以GMSCore.apk预装为例，
新建一个Android.mk文件，添加如下内容：

    include $(CLEAR_VARS)            # 清除所有临时变量
    LOCAL_MODULE := GmsCore	         # 定义当前模块的名称
    LOCAL_SRC_FILES := priv-app/$(LOCAL_MODULE)/$(LOCAL_MODULE).apk    #当前预装APK的路径
    LOCAL_MODULE_CLASS := APPS       # 模块的类别
    LOCAL_CERTIFICATE := platform    # APK签名
    LOCAL_PRIVILEGED_MODULE := true  # 表示当前APK到编译到priv-app目录
    include $(BUILD_PREBUILT)        # 预装编译

对于其他APK而言，只需要在Android.mk中添加类似的代码块即可，如此以来，这些APK就能编译产出到AOSP的**out/target/product/$TARGET_DEVICE**目录。为了将APK打包进最终的刷机包，还需要在对应**$TARGET_DEVICE**的device.mk中添加：

	PRODUCT_PACKAGES += GmsCore

