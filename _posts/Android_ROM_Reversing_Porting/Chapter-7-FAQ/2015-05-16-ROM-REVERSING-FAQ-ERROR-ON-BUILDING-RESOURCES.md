---
layout: post
title: ROM逆向适配——常见错误1
category: ROM逆向适配
tagline: 资源编译相关
tags: [资源编译]
---
{% include JB/setup %}

分析Android ROM逆向适配过程中的常见资源编译错误

***

## 非法资源名称导致编译失败

**错误提示**

    duanqizhi@xo:/smali-5.0/devices/base$ make 
    # use /smali-5.0/devices/base/recovery.fstab 
    >>> project: g2_cm, path: /home/duanqizhi/source/smali-5.0/devices/g2_cm 
    # use /smali-5.0/devices/base/recovery.fstab 
    make[1]: Entering directory `/home/duanqizhi/source/smali-5.0/devices/g2_cm' 
    >>> prebuilt-files done 
    >>> Nothing to do: bootimage 
    >>> Nothing to do: recoveryimage 
    >>> start auto merge framework-res 
    aapt package -u -x -z \ 
		-c hdpi,mdpi,normal,nodpi,en_US,zh_CN,en_US,zh_CN,en_US,xhdpi,xxhdpi --preferred-density xxhdpi \ 
		--min-sdk-version 21 \ 
		--target-sdk-version 21 \ 
		 \ 
		-M out/obj/system/framework/framework-res/AndroidManifest.xml \ 
		-A /smali-5.0/devices/base/framework-res/assets \ 
		\ 
		-S out/obj/system/framework/framework-res/board-res-overlay \ 
		-S /smali-5.0/devices/base/framework-res/res \ 
		-F out/obj/system/framework/framework-res.apk.tmp 1>/dev/null 
    invalid resource directory name:   /smali-5.0/devices/base/framework-res/res values-ￎ@-rES 
    make[1]: *** [out/obj/system/framework/framework-res.apk.tmp] Error 1 
    make[1]: Leaving directory `/home/duanqizhi/source/smali-5.0/devices/g2_cm' 
    make: *** [ota] Error 

**出错原因**

AAPT编译资源时，遇到非法的资源名称目录，本例中是`values-ￎ@-rES`目录不能被正确的解析。  
这个错误的根源是：apktool在处理一些不同国家的语言包时，还存在BUG，无法解析出对应的语言资源。


**解决方案**

- 可以先尝试升级apktool的版本，截至2015-05-16，最新的Release版本是2.0.0  
- 如果升级apktool版本无法解决该错误，可以先删除该资源目录，确保编译通过，后续如果出现与该目录中资源相关的BUG，再加上也行。

***

## 资源缺失导致索引超容

**错误提示**

    duanqizhi@xo:/smali-5.0/devices/base$ make 
    # use /smali-5.0/devices/base/recovery.fstab 
    >>> project: g2_cm, path: /home/duanqizhi/source/smali-5.0/devices/g2_cm 
    # use /smali-5.0/devices/base/recovery.fstab 
    make[1]: Entering directory `/home/duanqizhi/source/smali-5.0/devices/g2_cm' 
    >>> prebuilt-files done 
    >>> Nothing to do: bootimage 
    >>> Nothing to do: recoveryimage 
    >>> start auto merge framework-res 
    aapt package -u -x -z \ 
		-c hdpi,mdpi,normal,nodpi,en_US,zh_CN,en_US,zh_CN,en_US,xhdpi,xxhdpi --preferred-density xxhdpi \ 
		--min-sdk-version 21 \ 
		--target-sdk-version 21 \ 
		 \ 
		-M out/obj/system/framework/framework-res/AndroidManifest.xml \ 
		-A /smali-5.0/devices/base/framework-res/assets \ 
		\ 
		-S out/obj/system/framework/framework-res/board-res-overlay \ 
		-S /smali-5.0/devices/base/framework-res/res \ 
		-F out/obj/system/framework/framework-res.apk.tmp 1>/dev/null 
    /smali-5.0/devices/base/framework-res/res/values/public.xml:3914: error: Public symbol string/config_deviceKeyHandlerClass declared here is not defined. 
    /smali-5.0/devices/base/framework-res/res/values/public.xml:3913: error: Public symbol string/config_deviceKeyHandlerLib declared here is not defined. 
    /smali-5.0/devices/base/framework-res/res/values/public.xml:3923: error: Public symbol string/config_killSwitchClass declared here is not defined. 
    /smali-5.0/devices/base/framework-res/res/values/public.xml:3922: error: Public symbol string/config_killSwitchLib declared here is not defined. 
    /smali-5.0/devices/base/framework-res/res/values/public.xml:3917: error: Public symbol string/config_rat_2g declared here is not defined. 
    /smali-5.0/devices/base/framework-res/res/values/public.xml:3918: error: Public symbol string/config_rat_3g declared here is not defined. 
    /smali-5.0/devices/base/framework-res/res/values/public.xml:3919: error: Public symbol string/config_rat_4g declared here is not defined. 
    /smali-5.0/devices/base/framework-res/res/values/public.xml:5580: error: Public entry identifier 0x1040796 entry index is larger than available symbols (index 1942, total symbols 1942). 

    /smali-5.0/devices/base/framework-res/res/values/public.xml:5580: error: Public symbol string/mediaSize_na_gvrnmt_letter declared here is not defined. 
    /smali-5.0/devices/base/framework-res/res/values/public.xml:5582: error: Public entry identifier 0x1040798 entry index is larger than available symbols (index 1944, total symbols 1942). 

    /smali-5.0/devices/base/framework-res/res/values/public.xml:5582: error: Public symbol string/mediaSize_na_junior_legal declared here is not defined. 
    /smali-5.0/devices/base/framework-res/res/values/public.xml:5583: error: Public entry identifier 0x1040799 entry index is larger than available symbols (index 1945, total symbols 1942). 

    /smali-5.0/devices/base/framework-res/res/values/public.xml:5583: error: Public symbol string/mediaSize_na_ledger declared here is not defined. 
    /smali-5.0/devices/base/framework-res/res/values/public.xml:5581: error: Public entry identifier 0x1040797 entry index is larger than available symbols (index 1943, total symbols 1942). 

    /smali-5.0/devices/base/framework-res/res/values/public.xml:5581: error: Public symbol string/mediaSize_na_legal declared here is not defined. 
    /smali-5.0/devices/base/framework-res/res/values/public.xml:5584: error: Public entry identifier 0x104079a entry index is larger than available symbols (index 1946, total symbols 1942). 

    /smali-5.0/devices/base/framework-res/res/values/public.xml:5584: error: Public symbol string/mediaSize_na_tabloid declared here is not defined. 
    /smali-5.0/devices/base/framework-res/res/values/public.xml:5585: error: Public entry identifier 0x104079b entry index is larger than available symbols (index 1947, total symbols 1942). 

    /smali-5.0/devices/base/framework-res/res/values/public.xml:5585: error: Public symbol string/transient_navigation_confirmation declared here is not defined. 
    /smali-5.0/devices/base/framework-res/res/values/public.xml:5586: error: Public entry identifier 0x104079c entry index is larger than available symbols (index 1948, total symbols 1942). 

    /smali-5.0/devices/base/framework-res/res/values/public.xml:5586: error: Public symbol string/transient_navigation_confirmation_long declared here is not defined. 
    make[1]: *** [out/obj/system/framework/framework-res.apk.tmp] Error 1 
    make[1]: Leaving directory `/home/duanqizhi/source/smali-5.0/devices/g2_cm' 
    make: *** [ota] Error 2 

**出错原因**

本例的错误日志可以从两块来看：

- 找不到字符串资源

  连续出现7个字符串资源在framework-res/res/values/`public.xml`这个文件中存在资源符号定义，但又实际找不到定义的资源。以`string/config_deviceKeyHandlerClass`这个字符串资源为例: 

      Public symbol string/config_deviceKeyHandlerClass declared here is not defined. 

  `public.xml`中可以找到该资源ID的定义，但在values/string.xml缺失了这个资源字符串的内容。

- 资源ID超过使用范围

  连续出现了7个资源越界的报错, 以第1个出现错误为例：

      Public entry identifier 0x1040796 entry index is larger than available symbols (index 1942, total symbols 1942). 

  `total symbols`表示当前类型的资源总数，这里表示所有字符串类型的资源ID数量是`1942`个，索引范围是`0～1941`，但当前0x1040796指向的字符串资源，它的索引(index)是1942，已经超出了索引范围，导致编译出错。


这两个类型的错误是有连带关系的，解决了字符串资源找不到的问题，就顺带被资源ID越界的错误解决了。


首先，我们来看怎么计算资源`index`。打开framework-res/res/values/public.xml(这个文件是Android为了向下兼容，设计的一个资源映射表，
它将一些资源名称映射到固定的资源ID，这样就能够保证在不同的Android版本上，使用同样的资源ID能够访问到同样的资源)。

不同类型的资源ID一定是连续的，以字符串string为例，起始的资源ID(最小值)是`0x01040000`，末尾的资源ID(最大值)是`0x0104079c`，后者减去前者是`0x79c`，十进制的值是`1948`
说明一共有应该有`1949`个字符串类型的资源，索引范围是`0～1948`

    other resources type
    ...
    <public type="string" name="cancel" id="0x01040000" />
    <public type="string" name="copy" id="0x01040001" />
    <public type="string" name="copyUrl" id="0x01040002" />
    ...
    ...
    <public type="string" name="mediaSize_na_gvrnmt_letter" id="0x01040796" />
    <public type="string" name="mediaSize_na_legal" id="0x01040797" />
    <public type="string" name="mediaSize_na_junior_legal" id="0x01040798" />
    <public type="string" name="mediaSize_na_ledger" id="0x01040799" />
    <public type="string" name="mediaSize_na_tabloid" id="0x0104079a" />
    <public type="string" name="transient_navigation_confirmation" id="0x0104079b" />
    <public type="string" name="transient_navigation_confirmation_long" id="0x0104079c" />
    ...
    other resources type

`public.xml`中，最后7个资源ID在被解析时，它们的索引值分别是`0x796(1942)`, `0x797(1943)`... `0x79c(1948)`，即相对起始资源ID`0x01040000`的偏移，
但实际的资源总数是`1942`，范围只有`0～1941`，所以，从1942开始索引的资源(最后的7个资源)都会越界。


然后，我们来看怎么计算资源的`total symbols`，虽然public.xml定义了`1949`个字符串资源，但AAPT处理framework-res的时候，只能找到`1942`个字符串资源，为什么呢？原因就出在之前有`7个资源(1949-1942=7)`没有找到，
他们虽然在public.xml中定义了，但在values/string.xml中却没有定义。

**解决方案**

错误的原因是由于缺少资源的定义，导致public.xml无法被正确的解析。那么，我们如果在public.xml中，把缺少的资源映射去掉，不就可以解决问题吗？当然可以，但用这种方式来解决，会很困难。
因为public.xml要求资源ID必须是连续的，我们去掉其中若干行，就打破了这种连续性。而且Android推荐，我们只在public.xml的末尾增加扩展的ID，而不是去打破已有的顺序，否则就破坏了Android
的向下兼容性。

正确的解决办法是，去分析为什么这么资源定义会丢失。可能是我们误操作，删除了values/string.xml中的内容;也可能是APKTOOL处理的BUG，导致反编译时，就丢失了资源。前面的例子的说过，由于不同国家地区的语言差异，
APKTOOL可能将一些字符认定为非法的。

当然，如果实在找不到这些丢失的字符串资源，我们可以将这些字符串资源补上，来解决编译问题，打开framework-res/res/values/string.xml文件，对于于本例丢失的7个资源而言，可以在文件末尾添加如下内容：

    <string name="config_deviceKeyHandlerClass">APKTOOL_DUMMY_1</string> 
    <string name="config_deviceKeyHandlerLib">APKTOOL_DUMMY_2</string> 
    <string name="config_killSwitchClass">APKTOOL_DUMMY_3</string> 
    <string name="config_killSwitchLib">APKTOOL_DUMMY_4</string> 
    <string name="config_rat_2g">APKTOOL_DUMMY_5</string> 
    <string name="config_rat_3g">APKTOOL_DUMMY_6</string> 
    <string name="config_rat_4g">APKTOOL_DUMMY_7</string> 

我们并不知道原始的资源内容是什么，这里都以APKTOOL_DUMMY来替代了，如果存在最终使用上问题，还需要根据实际情况来调整。


***

## 缺少多语言资源引发的问题

**错误提示**

    duanqizhi@xo:/smali-5.0/devices/base$ make
    # use /smali-5.0/devices/base/recovery.fstab 
    >>> start auto merge framework-res 
    aapt package -u -x -z \ 
		-c hdpi,mdpi,normal,nodpi,en_US,zh_CN,en_US,zh_CN,en_US,xhdpi,xxhdpi --preferred-density xxhdpi \ 
		--min-sdk-version 21 \ 
		--target-sdk-version 21 \ 
		 \ 
		-M out/obj/system/framework/framework-res/AndroidManifest.xml \ 
		-A /smali-5.0/devices/base/framework-res/assets \ 
		\ 
		-S out/obj/system/framework/framework-res/board-res-overlay \ 
		-S /smali-5.0/devices/base/framework-res/res \ 
		-F out/obj/system/framework/framework-res.apk.tmp 1>/dev/null 
    warning: string 'app_no_restricted_accounts' has no default translation. 
    warning: string 'app_no_restricted_accounts' is missing 2 required localizations: en_US zh_CN 
    warning: string 'config_partial_segment_expire_age' has no default translation. 
    warning: string 'config_partial_segment_expire_age' is missing 2 required localizations: en_US zh_CN 
    warning: string 'config_perf_profile_default_entry' has no default translation. 
    warning: string 'config_perf_profile_default_entry' is missing 2 required localizations: en_US zh_CN 
    warning: string 'config_perf_profile_prop' has no default translation. 
    warning: string 'config_perf_profile_prop' is missing 2 required localizations: en_US zh_CN 
    warning: string 'description_direction_down' has no default translation. 
    warning: string 'description_direction_down' is missing 2 required localizations: en_US zh_CN 
    warning: string 'description_direction_left' has no default translation. 
    warning: string 'description_direction_left' is missing 2 required localizations: en_US zh_CN 
    warning: string 'description_direction_right' has no default translation. 
    warning: string 'description_direction_right' is missing 2 required localizations: en_US zh_CN 
    warning: string 'description_direction_up' has no default translation. 
    warning: string 'description_direction_up' is missing 2 required localizations: en_US zh_CN 
    warning: string 'description_target_camera' has no default translation. 
    warning: string 'description_target_camera' is missing 2 required localizations: en_US zh_CN 
    warning: string 'description_target_search' has no default translation. 
    warning: string 'description_target_search' is missing 2 required localizations: en_US zh_CN 
    warning: string 'description_target_silent' has no default trans1lation. 
    warning: string 'description_target_silent' is missing 2 required localizations: en_US zh_CN 
    warning: string 'description_target_soundon' has no default translation. 
    warning: string 'description_target_soundon' is missing 2 required localizations: en_US zh_CN 
    warning: string 'description_target_unlock' has no default translation. 
    warning: string 'description_target_unlock' is missing 2 required localizations: en_US zh_CN

**出错原因**

这里只是在编译资源时出现了警告，并没有引发编译错误。警告的内容是`is missing 2 required localizations: en_US zh_CN`，指明这些资源缺少中文和英文的定义。
这是因为，最初设计这些资源的时候，就不会被用到英文和中文的地区，它们可能只有俄文版本。

如果最终编译产出是包含所有的语言资源包的，那不会引发运行时的错误。但如果我们裁剪掉一些资源，就可能会引发运行时找不到资源的错误。

    Caused by: android.content.res.Resources$NotFoundException: String resource ID #0x104011b

那么，我们为什么要裁剪掉一些资源呢？这是有实际意义的，假如我们定制的ROM版本只在中文的地区发布，那很有必要裁剪掉非中文的资源，来减少ROM包的大小，提高运行效率。实际上AAPT在编译资源的时候，
也是支持通过编译参数，对一些不需要的资源进行裁剪来减少资源APK的大小。对于本例而言，假设我们裁剪掉非中文的资源，那么裁剪后，就会出现无法找到资源的情况。

本例中，名称为app_no_restricted_accounts的字符串，它的内容没有中文定义，我们通过AAPT编译编译选项，将非中文的资源都去掉了，那么这个字符串就找不到了。
AAPT编译资源时，并不会报错，public.xml仍然存在这个资源的映射关系。使用APKTOOL反编译时，由于找不的这个字符串资源的定义，就在public.xml中生成DUMMY的伪定义：

    <public type="string" name="APKTOOL_DUMMY_011b" id="0x0x104011b" />

使用APKTOOL反编译后，看到很多APKTOOL_DUMMY的关键字，就是因为在public.xml中有定义，但实际又找不到资源导致的。

如果恰巧有地方使用了这个资源，而且运行时会调用这段代码，那就会出现无法找到资源的错误`android.content.res.Resources$NotFoundException`。

**延伸知识**

1. Android如何做到对多语言的支持？


   <u>TODO</u>


2. 通过反编译时无法找到资源的警告，我们能学到什么？

   诚然，一个健壮的代码逻辑，应该尽可能的避免缺少默认资源的警告，因为这不利于移植。

   这也是通过`逆向工程`的思想来分析已有代码逻辑的一个案例。通过反编译的手段，我们发现代码设计的一些问题，从而推进设计优化。
