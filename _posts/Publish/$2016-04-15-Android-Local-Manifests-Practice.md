---
layout: post
category: Publish
title: Android Local Manifests机制的使用实践
tagline:
tag: 代码管理
---

# 1. Android源码管理的清单

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

# 2. Local Manifests机制

`repo`命令的执行依赖于解析清单文件的结果，解析时，就约定了在**manifests/default.xml**的基础上，融合**local_manifest.xml**文件和**local_manifests/**目录下的文件，生成一个的数据结构**manifest_xml**。**Local Manifests**机制的原理图如下所示：

<div align="center"><img src="/assets/images/localmanifests/1-local-manifests-mechanism.png" alt="mechanisim"/></div>

清单文件的解析由*[manifest_xml.py](https://gerrit.googlesource.com/git-repo/+/master/manifest_xml.py)*这个脚本负责;解析结果输出给其他命令，譬如`repo sync`。这里有一些隐含的规则：

- 先解析**local_manifest.xml**，再解析**local_manifests/**目录下的清单文件;

- **local_manifests**目录下的清单文件是没有命名限制的，但会按照字母序被解析，即字母序靠后的文件内容会覆盖之前的;

- 所有清单文件的内容必须遵循`repo`定义的格式[3]才能被正确解析。

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


执行完`repo sync`后，本地的代码目录结构如下所示：

{% highlight console %}
LocalManifestsDemo
├── B (stable)
└── C (master)
{% endhighlight %}

可以看到, 项目 **A** 的代码目录被删除了，项目 **B** 被切换到了stable分支，新增了一个项目 **C**。

# 3. Local Manifests应用

只要准备好本地的**local_manifests/**目录，**Local Manifests**机制就生效了。因此，设计一套自动生成**local_manifests/**目录的方案，就能完成清单文件定制的需求，本文给出的方案图如下所示：

<div align="center"><img src="/assets/images/localmanifests/2-local-manifests-usage.png" alt="usage"/></div>

- 在服务器上配置清单文件的定制信息;
- 在本地植入生成**local_manifests/**目录的客户端。

服务端和客户端的具体实现由业务场景决定，譬如：服务端可以部署很多git库，客户端可以输入git库的名称，向服务端发起查询请求，获取服务端返回的git库的信息，然后生成本地的**local_manifests/**目录，客户端和服务端通信可以基于HTTP实现。

## 3.1 同一Android分支编译不同版本

一个Android分支对应到一份清单文件，一份清单文件定义了Android源码中包含了git库(由&lt;project&gt;标签定义)和git库所在的分支(由&lt;project&gt;标签的revision属性定义)，所以，一个Android分支所包含的git库是不变的。
然而，为了编译出不同版本的固件，需要在这个分支上增加或删除一些git库，一种方案是增加新的分支：

<div align="center"><img src="/assets/images/localmanifests/3-local-manifests-scene1-plus-branches.png"/></div>

对于设备厂商而言，增加分支会导致提高维护成本，所以，避免增加分支的方案也有很多，譬如编译时开关、运行时反射等，**Local Manifests**也是一种有效的方案。以CyanogenMod为例，在同一分支上编译出数百款机型，机型不同自然就会有很多差异的地方，譬如kernel、配置项、固件中的APK，所以CyanogenMod把不同机型的差异项抽离出来，放到了**local_manifests**中：

<div align="center"><img src="/assets/images/localmanifests/4-local-manifests-scene1-plus-manifests.png"/></div>

每一个机型都有自己的**local_manifests**，它们对默认的清单文件进行了定制，这样一来，只需要在编译时准备不同的**local_manifests**，就能在同一Android分支编译出不同固件。实际上，不同的固件还是对应到不同的清单文件，所以，本质上与增加一份**local_manifests**与增加一个分支并没有不同，都是对已有清单文件的定制，只不过通过**local_manifests**来集中维护有差异的git库，比维护一个分支的成本要低。

CyanogenMod所有机型的device库和vendor库都放到了<https://github.com/>上，
在执行lunch命令时，植入了生成**local_manifests**的客户端：

- 根据lunch命令获取机型名称，通过github的Search API[4]，从服务器上查询机型的依赖库的信息;

- 将获取到的依赖库信息重新组织成XML格式，添加到**local_manfiests/**目录下的清单文件中。

## 3.2 多个Android分支编译不同版本

设备厂商会基于同一Android版本构建很多分支，以适应不同芯片平台、不同发布版本的开发需要; 多个分支，就对应到多份清单文件。
编译不同分支时，就需要指定到不同的清单文件下载代码。通过`repo init`命令的 *-b* 参数指定不同的分支，其实就是指定不同的清单文件。
每个分支都可能出定制版本，譬如针对运营商的定制版(移动/联通/电信版)、针对海外市场的定制版，一种解决方案是增加分支：

<div align="center"><img src="/assets/images/localmanifests/5-local-manifests-scene2-plus-branches.png"/></div>

设备厂商一般不会采用以上方案，每一类定制版都增加一个分支，会导致分支成倍的扩张，这会变得不可维护。
通过编译开关等手段，还是可以在已有分支上编出不同的定制版，但在同一份代码中兼容太多的差异，也会提升代码的维护成本。
将差异的git库放到**local_manifests**中，实现已有分支的定制需求，是一种有效的方案：

<div align="center"><img src="/assets/images/localmanifests/6-local-manifests-scene2-plus-manifests.png"/></div>

通过**local_manifests**，每个分支就能编译出定制化的固件，**local_manifests**就像一个切面，在已有的每个分支中，
都植入了相同的差异化内容。

以面向海外市场的定制版为例，需要在已有分支上都增加GMS(Google Mobile Services)，这时，可以将GMS组织成独立的git库，部署在代码服务器上，
在编译海外定制版时，植入**local_manifests**，在清单文件中添加GMS这个git库的信息。这种方式能够以较低的成本实现对已有多个分支的定制。

---

# 参考文献

1. repo介绍: <https://duanqz.github.io/2015-06-25-Intro-to-Repo>
2. CyanogenMod介绍：<https://wiki.cyanogenmod.org/w/About>
3. 清单文件的格式: <https://gerrit.googlesource.com/git-repo/+/master/docs/manifest-format.txt>
4. CyanogenMod的Search API文档：<https://developer.github.com/v3/search/>
