---
layout: post
category: Publish
title: Android Local Manifests机制的使用实践
tagline:
tag:
---

# 1. Android源码管理的清单文件

为了便于管理多个git库，Android提供了一套Python脚本，称为`repo`[1]，它是全局管理Android源码的利器，Android系统开发的第一步就是获取源码，这时，就需要用到`repo`命令了：

- **repo init**，用于初始化repo环境，一个XML格式的**manifest.xml**文件会生成在本地新建的**.repo/**中，**manifest.xml**定义了本地代码的目录结构，以及从远程下载的代码路径。

- **repo sync**，用于下载Android源码，这需要解析**manifest.xml**文件，按照指示下构建本地源码目录。

`repo`基于**manifest.xml**完成对Android源码的管理，**manifest.xml**是描述源码结构的清单，其实，它只是一个到**.repo/manifests/default.xml**的文件链接，真正的清单文件是通过**manifests**这个git库托管起来的，打开AOSP(Android Open Source Project)的[**manifests**库](https://android.googlesource.com/platform/manifest)，其中只包含一个**default.xml**文件，
这就是最基本的清单构成。**manifests**库会有很多分支，从最早的android-1.6_r1到目前最新的android-6.0.1_r9，**manifest**库其实是Android版本演进的一个标志，当**manifest**库有新的android-7.0.0_r1分支拉出时，就意味着Android N的发布。
Android不断在变化，不同版本所包含的库的清单是不一样，所以不同分支下的**default.xml**文件内容也是不同的。

在进行Android系统开发时，通常需要对清单文件进行定制，譬如以下场景：

- 设备厂商都会构建自己的**manifest**库，通常是基于AOSP的**default.xml**进行定制，譬如：去掉AOSP的一些git库、增加一些自有的git库。

- CyanogenMod[2]适配了数百款机型，官方提供的**default.xml**并没有囊括所有机型的代码清单，否则会导致下载太多不需要的代码。
  基于CyanogenMod进行开发时，只是按需下载待适配机型的代码，譬如：要适配**HTC One**这款机型，就需要向清单文件中额外添加这款机型[Device库](https://github.com/cyanogenmod/android_device_htc_m7)和[kernel库](https://github.com/cyanogenmod/android_kernel_htc_msm8960)

要实现定制清单的目的，可以直接对**default.xml**文件内容进行修改，然而这种方式在一些场景下存在弊端：

- 部分对**default.xml**的修改，不需要上传到代码服务器; 而定期同步最新的**default.xml**，就容易与本地的修改产生冲突;

- 设备厂商大都在是多分支的环境下开发，然而对不同**default.xml**修改的内容都是相同的，导致需要在多分支上重复提交相同的修改。

`repo`还支持另外一种定制方式：**Local Manifests**，在`repo sync`之前，会将**.repo/manifests/default.xml**和**.repo/local_manifests/**目录下存在清单文件进行合并，再根据融合的清单文件进行代码同步。
这样一来，只需要将清单文件的修改项放到**.repo/local_manifests/**目录下，
就能够在不修改**default.xml**的前提下，完成对清单的文件的定制。

# 2. Local Manifests机制的原理

笔者实现了Local Manifests机制的一个使用示例：<https://github.com/LocalManifestsDemo>，这是一个包含多个git库的项目。
该项目中，默认的**[default.xml](https://github.com/LocalManifestsDemo/manifests/blob/master/default.xml)**文件内容如下：

{% highlight xml %}
<?xml version="1.0" encoding="UTF-8"?>
<manifest>
  <remote name="origin" fetch=".." />

  <default revision="refs/heads/master" remote="origin" />

  <project path="A" name="LocalManifestsDemo/project-A" />
  <project path="B" name="LocalManifestsDemo/project-B" />
</manifest>
{% endhighlight %}

在**default.xml**中，配置了两个项目： **A** 和 **B**，每个项目对应到一个git库。
当执行完`repo sync`之后，本地的代码目录结构如下：

{% highlight console %}
LocalManifestsDemo
├── A (master)
└── B (master)
{% endhighlight %}


利用**Local Manifests**机制，新增[local_manifests/default_local.xml](https://github.com/LocalManifestsDemo/local_manifests/blob/master/default_local.xml)文件:

{% highlight xml %}
<?xml version="1.0" encoding="UTF-8"?>
<manifest>
  <remove-project name="LocalManifestsDemo/project-A" />
  <remove-project name="LocalManifestsDemo/project-B" />
  <project path="B" name="LocalManifestsDemo/project-B" revision="stable" />
  <project path="C" name="LocalManifestsDemo/project-C" />
</manifest>
{% endhighlight %}

在**local_manifests**目录下的**default_local.xml**文件中，定义了：

- 删除项目 **A**，通过&lt;remove-project&gt;标签可以删除项目
- 将项目 **B** 指定为stable分支，通过先删除后新增的方式间接完成对 **B** 的修改
- 新增项目 **C**

最终，融合的清单文件内容如下所示：

{% highlight xml %}
<?xml version="1.0" encoding="UTF-8"?>
<manifest>
  <remote name="origin" fetch=".." />

  <default revision="refs/heads/master" remote="origin" />

  <project path="B" name="LocalManifestsDemo/project-B" revision="stable" />
  <project path="C" name="LocalManifestsDemo/project-C" />
</manifest>
{% endhighlight %}

> **注意**：**local_manifests**目录下的清单文件是没有命名限制的，但会按照字母序被解析，即字母序靠后的文件内容会覆盖之前的。
> 所有清单文件的内容必须遵循`repo`定义的格式[3]才能被正确解析。

执行完`repo sync`后，本地的代码目录结构如下所示：

{% highlight console %}
LocalManifestsDemo
├── B (stable)
└── C (master)
{% endhighlight %}

可以看到, 项目 **A** 的代码目录被删除了，项目 **B** 被切换到了stable分支，新增了一个项目 **C**。


# 3. Local Manifests机制的应用

## 3.1 作为本地化清单

## 3.2 作为编译开关



---

# 参考文献

1. repo介绍: <https://duanqz.github.io/2015-06-25-Intro-to-Repo>
2. CyanogenMod介绍：<https://wiki.cyanogenmod.org/w/About>
2. 清单文件的格式: <https://gerrit.googlesource.com/git-repo/+/master/docs/manifest-format.txt>
2. manifest_xml.py: <https://gerrit.googlesource.com/git-repo/+/master/manifest_xml.py>
3. CyanogenMod使用Local Manifests机制: <https://wiki.cyanogenmod.org/w/Doc:_Using_manifests>
