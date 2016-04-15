---
layout: post
category: Publish
title: Android Local Manifests机制的使用实践
tagline:
tag:
---

# 1. Android源码的清单文件

为了便于管理多个git库，Android提供了一套Python脚本，称为`repo`[1]，它是全局管理Android源码的利器。
获取Android源码的第一步就是通过`repo init`命令初始化repo环境，一个XML格式的**manifest.xml**文件会生成在本地新建的**.repo/**中，
**manifest.xml**定义了本地代码的目录结构，以及从远程下载的代码路径，通过`repo sync`命令下载Android源码时，需要解析清单文件。

其实，**manifest.xml**只是一个到**.repo/manifests/default.xml**的文件链接，
真正的清单文件是通过**manifests**这个git库托管起来的，打开AOSP(Android Open Source Project)的[**manifests**库](https://android.googlesource.com/platform/manifest)，其中只包含一个**default.xml**文件，
这就是最基本的清单构成。**manifests**库会有很多分支，从最早的android-1.6_r1到目前最新的android-6.0.1_r9，
**manifest**库其实是Android版本演进的一个标志，当**manifest**库有新的android-7.0.0_r1分支拉出时，就意味着Android N的发布。
Android不断在变化，旧的库需要去除，新的库需要加入，所以不同分支下的**default.xml**文件内容也是不同的。

在进行Android系统开发时，通常需要对清单文件进行定制：

- 设备厂商都会构建自己的**manifest**库，通常是基于AOSP的**default.xml**进行定制，譬如：去掉AOSP的一些git库、增加一些自有的git库。
  

- CyanogenMod[2]适配了数百款机型，官方提供的**default.xml**并没有囊括所有机型的代码清单，否则会导致下载太多不需要的代码。
  基于CyanogenMod进行开发时，只是按需下载待适配机型的代码，譬如：要适配**HTC One**这款机型，就需要向清单文件中额外添加这款机型
  [Device库](https://github.com/cyanogenmod/android_device_htc_m7)和
  [kernel库](https://github.com/cyanogenmod/android_kernel_htc_msm8960)

要实现定制清单的目的，可以直接对**default.xml**文件内容进行修改，然而这种方式存在弊端：


Android还支持另外一种定制方式：**Local Manifests**。

所有清单文件的内容必须遵循Android定义的格式[2]才能被正确解析。

# 2. Local Manifests机制的原理


# 3. Local Manifests机制的应用

LocalManifestsDemo
└── project
    ├── A
    └── B


---

# 参考文献

1. repo介绍: <https://duanqz.github.io/2015-06-25-Intro-to-Repo>
2. CyanogenMod介绍：<https://wiki.cyanogenmod.org/w/About>
2. 清单文件的格式: <https://gerrit.googlesource.com/git-repo/+/master/docs/manifest-format.txt>
2. manifest_xml.py: <https://gerrit.googlesource.com/git-repo/+/master/manifest_xml.py>
3. CyanogenMod使用Local Manifests机制: <https://wiki.cyanogenmod.org/w/Doc:_Using_manifests>
