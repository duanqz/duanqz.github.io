---
layout: post
category: Android启智观
title: Android包管理机制
tagline:
tag: 包管理机制
---

每一个社会群落都有管理机制，其中有三个要素：被管理者、管理者以及管理机制的运转。在Android的世界中，有一处群落叫“包管理”，要研究Android的包管理机制，同样可以从以下几个角度来思考：

1. 被管理的对象是什么？
2. 管理者的职能是什么？
3. 管理机制是如何运转的？

所谓包，其实就是一种文件格式，譬如APK包、JAR包等。在Android中存活着很多包，所有的应用程序都是APK包，很多构成Android运行环境的都是JAR包，还有一些以so为后缀的库文件，包管理者很重要的一个职能就是识别不同的包，统一维护这些包的信息。当有一个包进入或离开Android世界，都需要向包管理者申报，其他管理部门要获取包的具体信息，也都需要向包管理者申请。

如同社会是由人与人的协作形成，不同的包之间也需要进行协作。既然有协作，自然就有协作的规范，一个包可以干什么，不可以干什么，都需要有一个明确的范围界定，这就是包管理中的权限设计。涉及到的内容非常广泛，Linux的UGO（User Group Other）和ACL（Access Control List，访问控制列表）权限管理、数字签名与验证、Android授权机制、Selinux，都是包管理中权限设计的组成部分。

Android的世界就如同一个井然有序的人类社会，除了包管理部门，还有其他各种管理部门，譬如电源管理、窗口管理、活动管理等等，大家不仅各司其职，而且也有交流往来。从APK的安装到Activity的显示这么一个看似简单的过程，却需要大量管理部门参与进来，不断地进行数据解析、封装、传递、呈现，内部机理十分复杂。

# 1 概要

- PackageInfo
- PackageItemInfo
- ComponentInfo
- ActivityInfo
- ServiceInfo
- ProviderInfo
- ApplicationInfo
- PermissionInfo
- InstrumentationInfo
- PackageParser
- PackageManagerService
- com.android.server.pm.Settings

PackageManagerService是包管理中最重要的服务，为了描述方便，本文会简写成**PMS**。

> PMS的部分函数带有**LI**后缀，表示需要获取**mInstalllock**这个锁时才能执行；部分函数带有**LP**后缀，表示需要获取**mPackages**这个锁才能执行。

# 2 被管理对象的形态

Android中的APK和JAR包都以静态文件的形式分布在不同的硬件分区，包管理者面临的第一个任务就是将这些静态的文件转化成内存的数据结构，这样才能将其管理起来。负责将静态文件转换内存中数据结构的工具就是PackageParser，包解析器。

<div align="center"><img src="/assets/images/packagemanager/1-packagemanager-package-from-static-to-dynamic.png" alt="Package from static to dynamic"/></div>

Android L(5.0)以后，支持APK拆分，即一个APK可以分割成很多部分，位于相同的目录下，每一个部分都是一个单独的APK文件，所有的APK文件具备相同的签名，在APK解析过程中，会将拆分的APK重新组合成内存中的一个Package。对于一个完整的APK，Android称其为**Monolithic**；对于拆分后的APK，Android称其为**Cluster**。

> 在Android L(5.0)以前，APK文件都是直接位于**app**或**priv-app**目录下，譬如短彩信APK的目录就是**/system/priv-app/Mms.apk**；到了Android L(5.0)之后，多了一级目录结构，譬如短彩信APK的目录是**/system/priv-app/Mms/Mms.apk**，这是Android为了支持APK拆分而做的改动，如果要将短彩信APK进行拆分，那所有被拆出来的APK都位于**/system/priv-app/Mms/**即可，这样在包解析时，就会变成以**Cluster**的方式解析目录。

一个包在内存中的数据结构就是**Package**，那么，Package有一些什么属性?是怎么从APK文件中获取数据的呢？ 这就涉及到包解析器的工作原理。

## 2.1 包解析器

为了先让读者对被管理对象有一个初步的认识，我们先把一个包最终在内存中的数据结构拎出来。其实生成这个数据结构，需要包管理者进行大量的调度工作，调度中心是PMS，包解析的过程也都是由PMS驱动的。在分析包解析过程之前，我们先上包解析的结果：

<div align="center"><img src="/assets/images/packagemanager/2-packagemanager-packageparser.png" alt="Package Parser"/></div>

这个类图，示意了一个包最终在内存中的数据结构**Package**，它包含很多属性，部分属性还是包解析器中的子数据结构。我们可以从设计的角度来理解这个类图：

- 一个包中有很多组件，为此设计了一个高层的基类**Component**，所有具体的组件都是**Component**的子类。什么是组件呢？**AndroidManifest.xml**文件中所定义的的一些标签，就是组件，譬如&lt;activity&gt;，&lt;service&gt;，&lt;provider&gt;，&lt;permission&gt;等，这些标签分别对应到包解析器中的一个数据结构，它们各自有自身的属性。

- 诸如&lt;activity&gt;，&lt;service&gt;标签，都可以配置&lt;intent-filter&gt;，来过滤其可以接收的Intent，这些信息也需要在包解析器中体现出来，为此组件**Component**依赖于**IntentInfo**这个数据结构。每一个具体的组件所依赖的**IntentInfo**不同，所以**Component**和**IntentInfo**之间的依赖关系采用了桥接(Bridge)这种设计模式，通过泛型的手段实现。

- 各种组件最终聚合到**Package**这个数据结构中，形成了最终包解析器的输出。当然，在解析的过程中，还有利用了一些数据结构来优化设计，**PackageLite**和**ApkLite**就是一些很简单的数据封装。

要得到以上的数据结构，包解析器**PackageParser**功不可没，从接收一个静态的文件(File类型)开始，会经过一个漫长的包解析过程，直到生成最终的**Package**：

    parsePackages(File file...)
    └── parseClusterPackage(File packageDir...)
        └── parseClusterPackageLite(File packageDir...)
        |   └── parseApkLite(File apkFile...)
        |       └── parseApkLite(String codePath...)
        └── parseBaseApk()
            └── parseBaseApplication()
            |    └── parseActivity()
            |    └── parseService()
            |    └── ...
            └── parseInstrumentation()
            └── ...

这些函数的具体逻辑本文不予分析，仅把关键的流程捋出来:

1. **PackageParser.parsePackages()**是包解析器的入口函数，它首先会判定给定的输入是否为一个目录，如果是目录，则以为着目录下可能存在多个拆分后的APK，这就需要以**Cluster**的方式进行解析；如果仅仅是一个APK文件，就以**Monolithic**的方式解析；

2. 解析APK，需要先得到一个中间数据结构**PacakgeLite**，包名、版本、拆分包等信息都会保存在这个数据结构中；由于一个包可能有多个拆分的APK，所以**PackageLite**可能关联到多个APK，每一个APK都对应到**ApkLite**这个数据结构，也是一些基本信息的封装。之所以以**Lite**为后缀命名，是因为这两个数据结构都比较轻量，只保存APK中很少信息；

3. 一个APK真正的信息都写在**AndroidManifest.xml**这个文件中，**PackageParser.parseBaseApk()**这个函数就是用来解析该文件。其解析过程与**AndroidManifest.xml**的文件结构一一对应，譬如先解析&lt;application&gt;标签的内容，然后解析其下的&lt;activity&gt;,&lt;service&gt;等标签。由于**AndroidManifest.xml**文件的结构非常复杂，所以该函数逻辑也非常庞大，读者们可以自行分析源码。

**至此，包解析器PackageParser就将一个静态的文件，转换成了内存中的数据结构Package，它包含了一个包的所有信息，如包名、包路径、权限、四大组件等，其数据来源主要就是AndroidManifest.xml文件。**

## 2.2 包信息体

包解析器从静态文件中获取的数据，很多都是需要用于跨进程传递的，譬如初次启动Activity时，就需要把包信息从系统进程传递到应用进程，先完成应用进程的启动。在包解析器的类图中，我们看到Activity、Service、Provider、Permission、Instrumentaion这些类都有一个共同的特征：都具备**info**这个属性，其实这些类的结构非常简单，就是对**info**的一次封装，**info**这个结构体才是真正的包数据，笔者暂且称之为“包信息体”:

<div align="center"><img src="/assets/images/packagemanager/3-packagemanager-packageparser-parcelable.png" alt="Package Parser Parcelable"/></div>

所有的**info**都实现了**Parcelable**接口，意图很明显，**info**是可以进行跨进程传递的。不同组件的**info**类型是不同的，除了实现了**Parcelable**接口，它们之间又构成了一个庞大的数据结构，把这些具体的**info**类型展开，就是以下的类图：

<div align="center"><img src="/assets/images/packagemanager/4-packagemanager-packageparser-parcelable.png" alt="Package Parser Parcelable"/></div>

可以看到，这个类图与**PackageParser**中的类图在结构上很相似，我们依旧是从设计的角度来理解这个类图：

- **PackageItemInfo**作为包每一项信息的高层基类：

  - 针对**permission**，**permission**，**instrumentation**等，分别为其设计了一个类，都继承自**PackageItemInfo**
  - 针对**activity**，**service**，**provider**等四大组件，在**PackageItemInfo**之下又多设计了一层：**ComponentInfo**作为四大组件的基类
  - **ApplicationInfo**也是包信息中的一项，但与四大组件紧密相连，四大组件肯定都属于某个**Application**，所以**ComponentInfo**与**Application**存在依赖关系，继而，具体到每个组件都与Application存在依赖关系

- 所有的包信息都聚合到**PackageInfo**这个类中，**PackageInfo**就是一个包向外提供的所有信息。其实除了上图列出来的类，还有一些类没有示意出来，譬如ConfigurationInfo，FeatureInfo，它们都可以对应到AndroidManifest.xml中的标签。

这些结构体中的数据，都是在包解析器时初始化的，譬如**Activity**依赖于**ActivityInfo**，在解析**Activity**时，就会创建一个**ActivityInfo**对象，把&lt;activity&gt;所定义的数据全都填充到**ActivityInfo**中。读者可以思考一下**PackageParser**中的**Activity**与此处的**ActivityInfo**的分开设计的目的和好处是什么？

> 在分析包的形态时，我们见到了很多类，类的命名方式还有点相似，初读代码的时候，很容易陷入各个类之间复杂的关系网之中。不得不说，包在内存中的数据结构是比较庞大的，因为它蕴含的信息大多了。

# 3 PMS的启动过程

## 3.1 对象构建

```java
// 代码片段1：PMS部分属性的初始化
public PackageManagerService(Context context, Installer installer,
        boolean factoryTest, boolean onlyCore) {
    // 关键的Event日志，PMS开始启动了
    EventLog.writeEvent(EventLogTags.BOOT_PROGRESS_PMS_START,
            SystemClock.uptimeMillis());

    mContext = context;
    mFactoryTest = factoryTest;
    mOnlyCore = onlyCore;
    // 如果是eng版，则延迟做DexOpt
    mLazyDexOpt = "eng".equals(SystemProperties.get("ro.build.type"));
    mMetrics = new DisplayMetrics();
    // Settings是包管理中一个很重要的数据结构，用于维护所有包的信息
    mSettings = new Settings(mPackages);
    mSettings.addSharedUserLPw("android.uid.system", Process.SYSTEM_UID,
            ApplicationInfo.FLAG_SYSTEM, ApplicationInfo.PRIVATE_FLAG_PRIVILEGED);
    mSettings.addSharedUserLPw("android.uid.phone", RADIO_UID,
            ApplicationInfo.FLAG_SYSTEM, ApplicationInfo.PRIVATE_FLAG_PRIVILEGED);
    mSettings.addSharedUserLPw("android.uid.log", LOG_UID,
            ApplicationInfo.FLAG_SYSTEM, ApplicationInfo.PRIVATE_FLAG_PRIVILEGED);
    mSettings.addSharedUserLPw("android.uid.nfc", NFC_UID,
            ApplicationInfo.FLAG_SYSTEM, ApplicationInfo.PRIVATE_FLAG_PRIVILEGED);
    mSettings.addSharedUserLPw("android.uid.bluetooth", BLUETOOTH_UID,
            ApplicationInfo.FLAG_SYSTEM, ApplicationInfo.PRIVATE_FLAG_PRIVILEGED);
    mSettings.addSharedUserLPw("android.uid.shell", SHELL_UID,
            ApplicationInfo.FLAG_SYSTEM, ApplicationInfo.PRIVATE_FLAG_PRIVILEGED);

    long dexOptLRUThresholdInMinutes;
    if (mLazyDexOpt) {
        dexOptLRUThresholdInMinutes = 30; // only last 30 minutes of apps for eng builds.
    } else {
        dexOptLRUThresholdInMinutes = 7 * 24 * 60; // apps used in the 7 days for users.
    }
    mDexOptLRUThresholdInMills = dexOptLRUThresholdInMinutes * 60 * 1000;
    ...
    mInstaller = installer;
    // DexOpt工具类
    mPackageDexOptimizer = new PackageDexOptimizer(this);
    mMoveCallbacks = new MoveCallbacks(FgThread.get().getLooper());
    mOnPermissionChangeListeners = new OnPermissionChangeListeners(
                FgThread.get().getLooper());
    getDefaultDisplayMetrics(context, mMetrics);
    // 读取系统默认的权限
    SystemConfig systemConfig = SystemConfig.getInstance();
    mGlobalGids = systemConfig.getGlobalGids();
    mSystemPermissions = systemConfig.getSystemPermissions();
    mAvailableFeatures = systemConfig.getAvailableFeatures();

    // 这里上了两把锁: mInstallLock是安装APK时需要用到的锁；mPackage是更新APK信息时需要的锁
    synchronized (mInstallLock) {
    synchronized (mPackages) {
        // 构建一个后台线程，并将线程的消息队列绑定到Handler
        mHandlerThread = new ServiceThread(TAG,
                Process.THREAD_PRIORITY_BACKGROUND, true /*allowIo*/);
        mHandlerThread.start();
        mHandler = new PackageHandler(mHandlerThread.getLooper());
        // 将PMS加入Watchdog的监控列表
        Watchdog.getInstance().addThread(mHandler, WATCHDOG_TIMEOUT);

        // 初始化一些文件目录
        File dataDir = Environment.getDataDirectory();
        mAppDataDir = new File(dataDir, "data");
        mAppInstallDir = new File(dataDir, "app");
        mAppLib32InstallDir = new File(dataDir, "app-lib");
        mAsecInternalPath = new File(dataDir, "app-asec").getPath();
        mUserAppDataDir = new File(dataDir, "user");
        mDrmAppPrivateInstallDir = new File(dataDir, "app-private");

        // 初始化系统权限
        ArrayMap<String, SystemConfig.PermissionEntry> permConfig
                = systemConfig.getPermissions();
        for (int i=0; i<permConfig.size(); i++) {
            SystemConfig.PermissionEntry perm = permConfig.valueAt(i);
            BasePermission bp = mSettings.mPermissions.get(perm.name);
            if (bp == null) {
                bp = new BasePermission(perm.name, "android", BasePermission.TYPE_BUILTIN);
                mSettings.mPermissions.put(perm.name, bp);
            }
            if (perm.gids != null) {
                bp.setGids(perm.gids, perm.perUser);
            }
        }

        // 初始化PMS中的ShareLibraries
        ArrayMap<String, String> libConfig = systemConfig.getSharedLibraries();
        for (int i=0; i<libConfig.size(); i++) {
            mSharedLibraries.put(libConfig.keyAt(i),
                    new SharedLibraryEntry(libConfig.valueAt(i), null));
        }

        // 读取mac_permission.xml文件的内容
        mFoundPolicyFile = SELinuxMMAC.readInstallPolicy();

        mRestoredSettings = mSettings.readLPw(this, sUserManager.getUsers(false),
                mSdkVersion, mOnlyCore);
        String customResolverActivity = Resources.getSystem().getString(
                        R.string.config_customResolverActivity);

// 未完接代码片段2
```

【代码片段1】完成了很多PMS的属性初始化操作，几个重要的属性如下：

- **mSettings**：PMS内部有一个Settings数据结构，用于维护所有包的信息。写过Android应用程序的朋友可能知道两个APK可以运行在相同的进程中，前提是两个APK具有相同的签名和ShareUid。Android系统中定义了一些默认的ShareUid，譬如**android.uid.system**表示系统进程的UID，如果有一个APK想要运行在系统进程中，则其需要在AndroidManifest.xml文件中声明ShareUid为**android.uid.system**，并且该APK的签名必须与framework-res.apk的签名一致，即platform签名。

  PMS在创建完Settings对象之后，便把很多系统默认的ShareUid加入其中。

- **mInstaller**：Installer是一个系统服务，它封装了很多PMS进行包管理需要用到的函数，譬如install()、 dexopt()、rename()等。在Installer内部，其实是通过Socket连接**installd**，将执行指令发送到**installd**完成具体的操作。

- **mPackageDexOptimizer**: 进行Dex优化的工具类。对于一个APK而言，编译后其APK包中可执行文件的格式dex，安装到了手机上以后，需要经过文件格式转化才能运行，譬如APK需要转换成oat格式才能在ART虚拟机上运行，文件格式转换的过程就叫DexOpt。

  DalvikVM的时代，Android可执行文件的格式是dex，有一种进一步优化的格式叫odex；ART虚拟机的时代，Android可执行文件的格式是oat。虽然都叫做DexOpt，但在DalvikVM和ART两种不同虚拟机的时代分别有不同的内涵。

- **SystemConfig**: 系统全局的配置信息的数据结构。原始的数据来源于**/system/etc/sysconfig**和**/system/etc/permissions**目录下的XML文件，在SystemConfig对象构建时，会读取这两个目录下所有XML文件的内容，主要有以下几个维度：

  - 权限与GID的映射关系，譬如，以下内容表示属于**inet**这个组的用户都拥有**android.permission.INTERNET**权限：

    ```xml
    <permission name="android.permission.INTERNET" >
        <group git="inet">
    </permission>
    ```

  - 权限与UID的映射关系，譬如，以下内容表示UID为**meida**用户拥有**android.permission.CAMERA**这个权限:

    ```xml
    <assign-permission name="android.permission.CAMERA" uid="media" />
    ```

  - 公共库的定义。Android中有很多公共库，除了BOOTCLASSPATH中定义的，框架层还支持额外的扩展，譬如，以下内容表示公共库的包名和其路径的关系：

    ```xml
    <library name="android.test.runner"
             file="/system/framework/android.test.runner.jar" />
    ```

- **mHandler**： 创建PackageHandler对象，将其绑定到一个后台线程的消息队列。可想而知，一些厚重的活，譬如安装APK，就交由这个后台线程完成了。由于PMS是一个重要的系统服务，这个后台线程的消息队列如果过于忙碌，则会导致系统一直卡住，所以需要将这个消息队列加入Watchdog的监控列表，以便在这种情况下，Watchdog可以做出一些应急操作。

- **初始化一些/data文件目录**：应用程序的安装和运行都需要用到Data分区，PMS会在Data分区新建一些子目录。

- **初始化系统权限**：在SystemConfig初始化的时候，从**/system/etc/permissions**和**/system/etc/sysconfig**目录下读取了XML文件，这些信息要添加到Settings这个数据结构中。Android设计了一个BasePermission的数据结构，主要用于保存权限与包名之间的映射关系，此处，添加的权限是从SystemConfig中取出，包名是android，也就是先将系统权限添加到Settings中。

- **mFoundPolicyFile**: 有了SeLinux以后，Android会为每个文件打上SE Label，对于APK而言，打SE Label的准则就是签名，即根据签名信息打上不同的SE Label。Android将签名分类成为platform，testkey, media等，签名与类别的映射关系就存在一个叫**mac_permission.xml**的文件中。此处，需要读取该文件的内容。

在完成部分属性的初始化之后，PMS要进入扫描安装阶段了。

```java
//代码片段2：DexOpt处理，扫描系统文件
    // 关键日志，开始扫描系统APP
    EventLog.writeEvent(EventLogTags.BOOT_PROGRESS_PMS_SYSTEM_SCAN_START,
            startTime);

    // 设置扫描参数
    final int scanFlags = SCAN_NO_PATHS | SCAN_DEFER_DEX | SCAN_BOOTING | SCAN_INITIAL;
    // 1. 构建数组变量用于保存已经做过DexOpt的文件，后文中，会往这个数组变量中添加元素
    final ArraySet<String> alreadyDexOpted = new ArraySet<String>();
    final String bootClassPath = System.getenv("BOOTCLASSPATH");
    final String systemServerClassPath = System.getenv("SYSTEMSERVERCLASSPATH");

    // BOOTCLASSPATH环境变量所定义的文件已经做过DexOpt
    if (bootClassPath != null) {
        String[] bootClassPathElements = splitString(bootClassPath, ':');
        for (String element : bootClassPathElements) {
            alreadyDexOpted.add(element);
        }
    }

    // SYSTEMSERVERCLASSPATH环境变量所定义的文件已经做过了DexOpt
    if (systemServerClassPath != null) {
        String[] systemServerClassPathElements = splitString(systemServerClassPath, ':');
        for (String element : systemServerClassPathElements) {
            alreadyDexOpted.add(element);
        }
    }

    // 获取指令集，以便后续进行DexOpt
    final List<String> allInstructionSets = InstructionSets.getAllInstructionSets();
    final String[] dexCodeInstructionSets =
            getDexCodeInstructionSets(
                        allInstructionSets.toArray(new String[allInstructionSets.size()]));

    // 公共库是定义在 etc/sysconfig 和 etc/permissions 文件夹下的XML文件中
    // 需要这些公共库进行DexOpt处理
    if (mSharedLibraries.size() > 0) {
        for (String dexCodeInstructionSet : dexCodeInstructionSets) {
            for (SharedLibraryEntry libEntry : mSharedLibraries.values()) {
                final String lib = libEntry.path;
                if (lib == null) {
                    continue;
                }
                try {
                    int dexoptNeeded = DexFile.getDexOptNeeded(lib, null, dexCodeInstructionSet, false);
                    if (dexoptNeeded != DexFile.NO_DEXOPT_NEEDED) {
                        alreadyDexOpted.add(lib);
                        mInstaller.dexopt(lib, Process.SYSTEM_UID, true, dexCodeInstructionSet, dexoptNeeded);
                    }
                } catch (...)
            }
        }
    }

    File frameworkDir = new File(Environment.getRootDirectory(), "framework");
    alreadyDexOpted.add(frameworkDir.getPath() + "/framework-res.apk");
    alreadyDexOpted.add(frameworkDir.getPath() + "/core-libart.jar");

    // system/framework目录下，除了framework-res.apk和core-libart.jar这两个文件外
    // 其他的APK和JAR文件都需要进行DexOpt处理
    String[] frameworkFiles = frameworkDir.list();
    if (frameworkFiles != null) {
        for (String dexCodeInstructionSet : dexCodeInstructionSets) {
            for (int i=0; i<frameworkFiles.length; i++) {
                File libPath = new File(frameworkDir, frameworkFiles[i]);
                String path = libPath.getPath();
                if (alreadyDexOpted.contains(path)) {
                    continue;
                }
                if (!path.endsWith(".apk") && !path.endsWith(".jar")) {
                    continue;
                }
                try {
                    int dexoptNeeded = DexFile.getDexOptNeeded(path, null, dexCodeInstructionSet, false);
                    if (dexoptNeeded != DexFile.NO_DEXOPT_NEEDED) {
                        mInstaller.dexopt(path, Process.SYSTEM_UID, true, dexCodeInstructionSet, dexoptNeeded);
                    }
                } catch(...)
            }
        }
    }

    // 2. Android M的APK授权机制有了变化，此处是与授权相关的版本兼容处理
    final VersionInfo ver = mSettings.getInternalVersion();
    mIsUpgrade = !Build.FINGERPRINT.equals(ver.fingerprint);
    mPromoteSystemApps =
            mIsUpgrade && ver.sdkVersion <= Build.VERSION_CODES.LOLLIPOP_MR1;
    if (mPromoteSystemApps) {
        Iterator<PackageSetting> pkgSettingIter = mSettings.mPackages.values().iterator();
        while (pkgSettingIter.hasNext()) {
            PackageSetting ps = pkgSettingIter.next();
            if (isSystemApp(ps)) {
                mExistingSystemPackages.add(ps.name);
            }
        }
    }

    // 3. 扫描系统文件
    File vendorOverlayDir = new File(VENDOR_OVERLAY_DIR);
    // 扫描 /vendor/overlay 目录下的文件
    scanDirLI(vendorOverlayDir, PackageParser.PARSE_IS_SYSTEM
            | PackageParser.PARSE_IS_SYSTEM_DIR, scanFlags | SCAN_TRUSTED_OVERLAY, 0);
    // 扫描 /system/framework 目录下的文件
    scanDirLI(frameworkDir, PackageParser.PARSE_IS_SYSTEM
            | PackageParser.PARSE_IS_SYSTEM_DIR
            | PackageParser.PARSE_IS_PRIVILEGED,
            scanFlags | SCAN_NO_DEX, 0);
    // 扫描 /system/priv-app 目录下的文件
    final File privilegedAppDir = new File(Environment.getRootDirectory(), "priv-app");
    scanDirLI(privilegedAppDir, PackageParser.PARSE_IS_SYSTEM
            | PackageParser.PARSE_IS_SYSTEM_DIR
            | PackageParser.PARSE_IS_PRIVILEGED, scanFlags, 0);
    // 扫描 /system/app 目录下的文件
    final File systemAppDir = new File(Environment.getRootDirectory(), "app");
    scanDirLI(systemAppDir, PackageParser.PARSE_IS_SYSTEM
            | PackageParser.PARSE_IS_SYSTEM_DIR, scanFlags, 0);
    // 扫描 /vendor/app 目录下的文件
    File vendorAppDir = new File("/vendor/app");
    try {
        vendorAppDir = vendorAppDir.getCanonicalFile();
    } catch (IOException e) {}
    scanDirLI(vendorAppDir, PackageParser.PARSE_IS_SYSTEM
            | PackageParser.PARSE_IS_SYSTEM_DIR, scanFlags, 0);
    // 扫描 /oem/app 目录下的文件
    final File oemAppDir = new File(Environment.getOemDirectory(), "app");
    scanDirLI(oemAppDir, PackageParser.PARSE_IS_SYSTEM
            | PackageParser.PARSE_IS_SYSTEM_DIR, scanFlags, 0);
    mInstaller.moveFiles();

    // 4. 对扫描到的系统文件善后处理
    final List<String> possiblyDeletedUpdatedSystemApps = new ArrayList<String>();
    if (!mOnlyCore) {
        Iterator<PackageSetting> psit = mSettings.mPackages.values().iterator();
        while (psit.hasNext()) {
            PackageSetting ps = psit.next();
            if ((ps.pkgFlags & ApplicationInfo.FLAG_SYSTEM) == 0) {
                continue;
            }
            final PackageParser.Package scannedPkg = mPackages.get(ps.name);
            if (scannedPkg != null) {
                if (mSettings.isDisabledSystemPackageLPr(ps.name)) {
                    removePackageLI(ps, true);
                    mExpectingBetter.put(ps.name, ps.codePath);
                }
                continue;
            }

            if (!mSettings.isDisabledSystemPackageLPr(ps.name)) {
                psit.remove();
                removeDataDirsLI(null, ps.name);
            } else {
                final PackageSetting disabledPs = mSettings.getDisabledSystemPkgLPr(ps.name);
                if (disabledPs.codePath == null || !disabledPs.codePath.exists()) {
                    possiblyDeletedUpdatedSystemApps.add(ps.name);
                }
            }
        }
    }

    ArrayList<PackageSetting> deletePkgsList = mSettings.getListOfIncompleteInstallPackagesLPr();
    for(int i = 0; i < deletePkgsList.size(); i++) {
        cleanupInstallFailedPackage(deletePkgsList.get(i));
    }
    deleteTempPackageFiles();
    mSettings.pruneSharedUsersLPw();
// 未完接代码片段3
```

【代码片段2】的主体逻辑如下：

1. 通过不断往alreadyDexOpted数组中填充元素，来略过不需要做DexOpt的文件：BOOTCLASSPATH和SYSTEMSERVERPATH这两个环境变量中定义的文件、system/framework-res.apk、system/core-libart.jar。除略过的文件外，其他APK和JAR文件都是需要做DexOpt处理的，通过调用**Installer.dexopt()**函数完成，这个函数只是将dexopt命令发送给installd。

2. 由于Android M的APK授权机制发生了变化，在扫描系统文件之前，做了一些简单的记录，以便后续的授权处理：

    - **mIsUpgrade**：如果当前版本的指纹与历史版本的指纹信息不一致，表示当前版本是一次OTA升级上来更新版本
    - **mPromoteSystemApps**：如果历史版本是Android M之前的版本(ver.sdkVersion <= Build.VERSION_CODES.LOLLIPOP_MR1)，当前又有版本升级，则需要用一个布尔变量，表示当前需要对系统应用的授权做特殊处理，此时会先把已有的系统应用都保存在**mExistingSystemPackages**这个数组中

3. 扫描系统文件，PMS中所有的文件扫描都是调用**scanDirLI()**函数，扫描系统文件重要的参数就是 **PackageParser.PARSE_IS_SYSTEM**和**PackageParser.PARSE_IS_SYSTEM_DIR**，在后文中我们会剖析这个函数。此处，需要注意的是被扫描目录的顺序，这个顺序意味着：先被扫描到的文件，就是最终被用到的文件。

    ```
    /vendor/overlay >> /system/framework >> /system/priv-app >> /system/app >> /vendor/app >> /oem/app
    ```

4. **possiblyDeletedUpdatedSystemApps**这个变量表示“可能被删除的系统APP”，这是一个什么概念呢？除了**possiblyDeletedUpdatedSystemApps**，还有**mExpectingBetter**，表示当前这个APK有更好的选择，这又是什么概念呢？对于一个系统APP而言，在一次OTA升级的过程中，有三种可能：

    - 保持原状。即这个系统APP没有任何更新。
    - 更新版本。即新的OTA版本中，这个系统APP有更新。
    - 不复存在。在新的OTA版本中已经删除了这个系统APP。

    当系统APP升级过后，PMS的Settings中会将原来的系统APP标识为Disable状态，这时候通过**Settings.isDisabledSystemPackageLPr()**函数调用便返回了false。因此，如果系统APP有更新版本，则属于**mExpectingBetter**这一类，接下来会扫描Data分区的文件，更新的系统APP就安装在Data分区。

    如果一个系统APP不复存在，而且也没有被标记为Disable状态，说明这个系统APP已经彻底不存在了，需要把其在Data分区下的数据删除；如果不复存在的系统APP被标记为Disable状态，那还不能确定该系统APP是否已经被删除，因为还没有扫描Data分区的文件，所以，只能暂时将其放到**possiblyDeletedUpdatedSystemApps**变量中，表示“可能被删除”，在扫描Data分区之前，这是不能确定的。

扫描完系统文件之后，接下来会扫描Data分区的文件。

```java
// 代码片段3：扫描Data分区文件，更新公共库信息
    if (!mOnlyCore) {
        // 关键日志，PMS对Data分区的文件扫描开始了
        EventLog.writeEvent(EventLogTags.BOOT_PROGRESS_PMS_DATA_SCAN_START,
                SystemClock.uptimeMillis());
        // 1. 扫描Data分区的文件目录
        scanDirLI(mAppInstallDir, 0, scanFlags | SCAN_REQUIRE_KNOWN, 0);
        scanDirLI(mDrmAppPrivateInstallDir, PackageParser.PARSE_FORWARD_LOCK,
                scanFlags | SCAN_REQUIRE_KNOWN, 0);
        // 2. 扫描完Data分区后，处理“可能被删除的系统应用”
        for (String deletedAppName : possiblyDeletedUpdatedSystemApps) {
            PackageParser.Package deletedPkg = mPackages.get(deletedAppName);
            mSettings.removeDisabledSystemPackageLPw(deletedAppName);
            String msg;
            if (deletedPkg == null) {
                removeDataDirsLI(null, deletedAppName);
            } else {
               deletedPkg.applicationInfo.flags &= ~ApplicationInfo.FLAG_SYSTEM;
               PackageSetting deletedPs = mSettings.mPackages.get(deletedAppName);
               deletedPs.pkgFlags &= ~ApplicationInfo.FLAG_SYSTEM;
            }
        }
        // 3. 处理有版本更新的系统应用
        for (int i = 0; i < mExpectingBetter.size(); i++) {
            final String packageName = mExpectingBetter.keyAt(i);
            if (!mPackages.containsKey(packageName)) {
                final File scanFile = mExpectingBetter.valueAt(i);
                final int reparseFlags;
                // 设置重新扫描的解析参数
                if (FileUtils.contains(privilegedAppDir, scanFile)) {
                    reparseFlags = PackageParser.PARSE_IS_SYSTEM
                            | PackageParser.PARSE_IS_SYSTEM_DIR
                            | PackageParser.PARSE_IS_PRIVILEGED;
                } else {...}

                // 将原来的系统应用重新置为Enable状态
                mSettings.enableSystemPackageLPw(packageName);
                try {
                    scanPackageLI(scanFile, reparseFlags, scanFlags, 0, null);
                } catch (PackageManagerException e) { ... }
            }
        }
    } // end of "if (!mOnlyCore)"
    mExpectingBetter.clear();

    // 4. 处理公共库
    updateAllSharedLibrariesLPw();
    for (SharedUserSetting setting : mSettings.getAllSharedUsersLPw()) {
         adjustCpuAbisForSharedUserLPw(setting.packages, null /* scanned package */,
                 false /* force dexopt */, false /* defer dexopt */);
    }

    mPackageUsage.readLP();
    // 关键日志，PMS扫描结束了
    EventLog.writeEvent(EventLogTags.BOOT_PROGRESS_PMS_SCAN_END,
            SystemClock.uptimeMillis());
// 未完接代码片段4
```

Data分区文件的扫描都被**mOnlyCore**这个布尔变量笼罩，当其为true时，表示只需要扫描系统文件；当其为false时，才会扫描Data分区文件。【代码片段3】的主体逻辑如下：

1. 调用**PMS.scanDirLI()**函数扫描 **/data/app** 和 **/data/app-private**两个目录的文件。后文会详细剖析该函数。

2. 扫描完Data分区的文件后，需要对之前系统文件的余孽做一些处理，第一类是**possiblyDeletedUpdatedSystemApps**，因为在扫描Data分区文件之前，不能确定系统应用有没有被彻底删除，如果在Data分区也无法找到了不复存在的系统应用，则需要彻底删除该系统应用；如果在Data分区找到了不复存在的系统应用，则需要去除其系统应用的标识。

3. 另外一类系统应用的余孽是**mExpectingBetter**，表示系统应用已经升级过。如果在Data分区无法找到这些升级过的系统应用，那很可能是用户在OTA升级时，清除了Data分区的数据，对于这种场景，需要重新扫描一下该应用原来位于系统分区的文件。

4. SystemConfig中定义了公共库，在APK的AndroidManifest.xml文件中，会通过&lt;use-library&gt;标签标记该APK动态依赖的公共库，此处的逻辑就是将APK与SystemConfig中的公共库关联起来。如果APK使用的公共库并不存在，则会抛出异常(INSTALL_FAILED_MISSING_SHARED_LIBRARY)。

```java
// 代码片段4：收尾工作
    // 授权
    int updateFlags = UPDATE_PERMISSIONS_ALL;
    if (ver.sdkVersion != mSdkVersion) {
        updateFlags |= UPDATE_PERMISSIONS_REPLACE_PKG | UPDATE_PERMISSIONS_REPLACE_ALL;
    }
    updatePermissionsLPw(null, null, updateFlags);
    ver.sdkVersion = mSdkVersion;

    // 多用户场景下的版本兼容处理
    if (!onlyCore && (mPromoteSystemApps || !mRestoredSettings)) {
        for (UserInfo user : sUserManager.getUsers(true)) {
            mSettings.applyDefaultPreferredAppsLPw(this, user.id);
            applyFactoryDefaultBrowserLPw(user.id);
            primeDomainVerificationsLPw(user.id);
        }
    }

    // 如果是升级新版本，则需要清除已有的Code cache目录
    if (mIsUpgrade && !onlyCore) {
        for (int i = 0; i < mSettings.mPackages.size(); i++) {
            final PackageSetting ps = mSettings.mPackages.valueAt(i);
            if (Objects.equals(StorageManager.UUID_PRIVATE_INTERNAL, ps.volumeUuid)) {
                deleteCodeCacheDirsLI(ps.volumeUuid, ps.name);
            }
        }
        ver.fingerprint = Build.FINGERPRINT;
    }
    checkDefaultBrowser();
    mExistingSystemPackages.clear();
    mPromoteSystemApps = false;
    ver.databaseVersion = Settings.CURRENT_DATABASE_VERSION;
    mSettings.writeLPr();

    // 关键日志，PMS已经启动完毕了
    EventLog.writeEvent(EventLogTags.BOOT_PROGRESS_PMS_READY,
            SystemClock.uptimeMillis());

    mRequiredVerifierPackage = getRequiredVerifierLPr();
    mRequiredInstallerPackage = getRequiredInstallerLPr();
    // 初始化包安装服务
    mInstallerService = new PackageInstallerService(context, this);
    mIntentFilterVerifierComponent = getIntentFilterVerifierComponentNameLPr();
    mIntentFilterVerifier = new IntentVerifierProxy(mContext,
            mIntentFilterVerifierComponent);
    } // synchronized (mPackages)
    } // synchronized (mInstallLock)

    Runtime.getRuntime().gc();
    LocalServices.addService(PackageManagerInternal.class, new PackageManagerInternalImpl());
} // PMS构造函数完结
```

【代码片段4】主要进行一些收尾工作，有几个关键点：

- 授权，通过调用**PMS.updatePermissionsLPw()**函数，后文会详细分析
- 版本兼容处理，Android M引入了多用户，需要更新每个APK关联到的userid
- 将PMS的Settings信息写入**/system/packages.xml**文件中，Settings是PMS中所有包信息的汇总的数据结构，PMS对包的管理极其依赖于这个数据结构。
- 初始化包安装服务PackageInstallerService。

**至此，PMS对象的构建过程已经分析完毕，整个逻辑还是较为清晰的，但其实这是一个非常耗时的过程，开机时间大部分都耗在文件扫描上。**

## 3.2 文件扫描

**scanDirLI()**只是文件扫描的起点，由此引发出一串的与文件扫描相关的函数。

<div align="center"><img src="/assets/images/packagemanager/5-packagemanager-scan-seq.png" alt="Package Scan Sequence Diagram"/></div>

接下来，笔者会按照调用时序，对关键函数进行分析。PMS对象构建时，待扫描的目录有很多，不同目录的文件扫描，只是在扫描参数上略有区别，整体逻辑上并无不同。

```java
private void scanDirLI(File dir, int parseFlags, int scanFlags, long currentTime) {
    final File[] files = dir.listFiles();
    if (ArrayUtils.isEmpty(files)) {
         return;
    }

    for (File file : files) {
        final boolean isPackage = (isApkFile(file) || file.isDirectory())
            && !PackageInstallerService.isStageName(file.getName());
        if (!isPackage) {
            continue;
        }
        try {
            scanPackageLI(file, parseFlags | PackageParser.PARSE_MUST_BE_APK,
                    scanFlags, currentTime, null);
        } catch (PackageManagerException e) {
            if ((parseFlags & PackageParser.PARSE_IS_SYSTEM) == 0 &&
                    e.error == PackageManager.INSTALL_FAILED_INVALID_APK) {
                // 如果扫描Data分区的APK失败，则删除Data分区扫描失败的文件
                if (file.isDirectory()) {
                    mInstaller.rmPackageDir(file.getAbsolutePath());
                } else {
                    file.delete();
                }
            }
        }
    }
}
```

对于待扫描目录**/system/priv-app**，该函数会针对每一个子目录调用**PMS.scanPackageLI()**函数，限定了解析参数**PackageParser.PARSE_MUST_BE_APK**，表示只解析APK文件。这个函数如果抛出异常，则说明解析出错，如果是扫描Data分区的APK出错，则需要删除扫描失败的文件。

下面，就开始扫描APK文件了：

```java
private PackageParser.Package scanPackageLI(File scanFile, int parseFlags, int scanFlags,
        long currentTime, UserHandle user) throws PackageManagerException {
    parseFlags |= mDefParseFlags;
    // 初始化PackageParser对象，用于解析包
    PackageParser pp = new PackageParser();
    pp.setSeparateProcesses(mSeparateProcesses);
    pp.setOnlyCoreApps(mOnlyCore);
    pp.setDisplayMetrics(mMetrics);

    if ((scanFlags & SCAN_TRUSTED_OVERLAY) != 0) {
        parseFlags |= PackageParser.PARSE_TRUSTED_OVERLAY;
    }

    final PackageParser.Package pkg;
    try {
        // 2. 解析包得到一个PackageParser.Package对象
        pkg = pp.parsePackage(scanFile, parseFlags);
    } catch(...)

    PackageSetting ps = null;
    PackageSetting updatedPkg;

    // 3. 判定系统APK是否需要更新
    synchronized (mPackages) {
        String oldName = mSettings.mRenamedPackages.get(pkg.packageName);
        if (pkg.mOriginalPackages != null && pkg.mOriginalPackages.contains(oldName)) {
            ps = mSettings.peekPackageLPr(oldName);
        }
        if (ps == null) {
            ps = mSettings.peekPackageLPr(pkg.packageName);
        }
        updatedPkg = mSettings.getDisabledSystemPkgLPr(ps != null ? ps.name : pkg.packageName);
    }

    boolean updatedPkgBetter = false;
    if (updatedPkg != null && (parseFlags&PackageParser.PARSE_IS_SYSTEM) != 0) {
        ...
        if (ps != null && !ps.codePath.equals(scanFile)) {
            if (pkg.mVersionCode <= ps.versionCode) {
                ...
                throw new PackageManagerException(INSTALL_FAILED_DUPLICATE_PACKAGE,
                        "Package " + ps.name + " at " + scanFile
                        + " ignored: updated version " + ps.versionCode
                        + " better than this " + pkg.mVersionCode);
            } else {
                ...
                InstallArgs args = createInstallArgsForExisting(packageFlagsToInstallFlags(ps),
                        ps.codePathString, ps.resourcePathString, getAppDexInstructionSets(ps));
                synchronized (mInstallLock) {
                    args.cleanUpResourcesLI();
                }
                synchronized (mPackages) {
                    mSettings.enableSystemPackageLPw(ps.name);
                }
                updatedPkgBetter = true;
            }
        }
    }
    ...
    // 4. 获取APK的签名信息
    collectCertificatesLI(pp, ps, pkg, scanFile, parseFlags);

    // 5. 在Data分区存在一个应用，与当前扫描的系统APK包名相同
    boolean shouldHideSystemApp = false;
    if (updatedPkg == null && ps != null
        && (parseFlags & PackageParser.PARSE_IS_SYSTEM_DIR) != 0 && !isSystemApp(ps)) {
        if (compareSignatures(ps.signatures.mSignatures, pkg.mSignatures)
                != PackageManager.SIGNATURE_MATCH) {
            // 签名不匹配
            deletePackageLI(pkg.packageName, null, true, null, null, 0, null, false);
            ps = null;
        } else {
           if (pkg.mVersionCode <= ps.versionCode) {
               shouldHideSystemApp = true;
           } else {
               InstallArgs args = createInstallArgsForExisting(packageFlagsToInstallFlags(ps),
                       ps.codePathString, ps.resourcePathString, getAppDexInstructionSets(ps));
               synchronized (mInstallLock) {
                   args.cleanUpResourcesLI();
               }
           }
        }
    }
    ...
    // 6. 调用另外一个scanPackageLI()函数，对包进行扫描
    PackageParser.Package scannedPkg = scanPackageLI(pkg, parseFlags, scanFlags
            | SCAN_UPDATE_SIGNATURE, currentTime, user);

    if (shouldHideSystemApp) {
        synchronized (mPackages) {
            mSettings.disableSystemPackageLPw(pkg.packageName);
        }
    }
    return scannedPkg;
}
```

1. 初始化包解析器**PackageParser**，在前文中，我们已经见识过它了，现在我们知道，包解析器是在PMS扫描文件时构建的；

2. 有了包解析器，对静态的APK文件进行解析，最终就是为了得一个包在内存中的数据结构**Package**，我们已经前文中提前见到了这个结构的全貌，一个包的所有信息都在其中；

3. 系统应用升级后会安装在Data分区，之前在System分区的应用会被标记为Disable状态。这些状态信息记录在PMS的Settings中，需要通过包名获取。包解析完成以后，就能得到一个APK的包名了。这一部分代码中有两个变量：pkg是Package类型，表示当前扫描的APK；ps是PackageSettings类型，表示PMS的Settings中保存的APK信息，即上一次安装的APK信息。通过比对这两个变量，就能知道当前扫描的APK与已经安装的历史APK的差异，如果当前扫描的系统APK版本比已经安装的系统APK版本要高，这就需要重新将系统APK设置为Enable状态；否则，中断扫描过程，抛出异常；

4. 之前构建**Package**对象时，还没有APK的签名信息，现在正是把APK签名信息填进去的时候，因为到这一步已经确定要安装APK了，APK能安装的前提就是一定要有签名信息；如果是对已有APK进行升级，那签名必须与已有APK匹配。**PMS.collectCertificatesLI()**函数就是从APK包中**META-INF**目录读取签名信息；

5. 处理系统APK已经被安装过的场景，已经被安装过的APK位于Data分区。**shouldHideSystemApp**表示是否需要将系统APK设置为Disable状态，默认情况下为false；如果安装过的APK的版本比当前扫描的系统APK的版本要高，则意味着要使用Data分区的APK，隐藏系统APK，**shouldHideSystemApp**被置为true；

6. 到这一步，已经通过包解析器完成了对APK文件的解析，并且做了一些安装场景的判断。接下来，需要对解析出来的**Package**进行处理，这交由另外一个**scanPackageLI()**函数完成。

```java
private PackageParser.Package scanPackageLI(PackageParser.Package pkg, int parseFlags,
        int scanFlags, long currentTime, UserHandle user) throws PackageManagerException {
    boolean success = false;
    try {
        final PackageParser.Package res = scanPackageDirtyLI(pkg, parseFlags, scanFlags,
            currentTime, user);
        success = true;
        return res;
    } finally {
        if (!success && (scanFlags & SCAN_DELETE_DATA_ON_FAILURES) != 0) {
            removeDataDirsLI(pkg.volumeUuid, pkg.packageName);
        }
    }
}
```

以上函数就是做了一层封装调用，如果扫描失败，且SCAN_DELETE_DATA_ON_FAILURES标志位被置上，则需要删除Data分区的APK文件。真正干活的是**scanPackageDirtyLI()**函数，这个函数逻辑非常庞大，随着Andorid版本的升级，函数体也越来越庞大，笔者仅仅挑出几个主干逻辑进行分析，省略大量分支逻辑：

```java
private PackageParser.Package scanPackageDirtyLI(PackageParser.Package pkg, int parseFlags,
int scanFlags, long currentTime, UserHandle user) throws PackageManagerException {
    ...
    // 1. 针对包名为“android”的APK进行处理
    if (pkg.packageName.equals("android")) {
        ...
        mPlatformPackage = pkg;
        pkg.mVersionCode = mSdkVersion;
        mAndroidApplication = pkg.applicationInfo;
        ...
    }
    ...
    // 2. 锁上mPacakges对象，意味着要对这个数据结构进行写操作，里面保存的就是已经解析出来的包信息
    synchronized (mPackages) {
        // 如果有定义ShareUserId，则创建一个ShareUserSetting对象
        if (pkg.mSharedUserId != null) {
            suid = mSettings.getSharedUserLPw(pkg.mSharedUserId, 0, 0, true);
            if (suid == null) {
                throw new PackageManagerException(INSTALL_FAILED_INSUFFICIENT_STORAGE,
                "Creating application package " + pkg.packageName
                + " for shared user failed");
            }
        }
        ...
        // 生成PackageSetting对象，对应的数据结构将序列化在/data/system/packags.xml文件中
        pkgSetting = mSettings.getPackageLPw(pkg, origPackage, realName, suid, destCodeFile,
                destResourceFile, pkg.applicationInfo.nativeLibraryRootDir,
                pkg.applicationInfo.primaryCpuAbi,
                pkg.applicationInfo.secondaryCpuAbi,
                pkg.applicationInfo.flags, pkg.applicationInfo.privateFlags,
                user, false);
         ...
         // 打上SELinux标签
         if (mFoundPolicyFile) {
             SELinuxMMAC.assignSeinfoValue(pkg);
         }
         ...
         // 签名验证
         if (shouldCheckUpgradeKeySetLP(pkgSetting, scanFlags)) {
             if (checkUpgradeKeySetLP(pkgSetting, pkg)) {
                 pkgSetting.signatures.mSignatures = pkg.mSignatures;
             }
             ...
         } else {
             verifySignaturesLP(pkgSetting, pkg);
             ...
         }
    }

    pkg.applicationInfo.processName = fixProcessName(
            pkg.applicationInfo.packageName,
            pkg.applicationInfo.processName,
            pkg.applicationInfo.uid);
    // 3. 生成APK的data目录
    File dataPath;
    if (mPlatformPackage == pkg) {
        // framework-res.apk的data目录是 /data/system
        dataPath = new File(Environment.getDataDirectory(), "system");
        pkg.applicationInfo.dataDir = dataPath.getPath();
    } else {
        // 其他APK的data目录是 /data/data/packageName
        dataPath = Environment.getDataUserPackageDirectory(pkg.volumeUuid,
                UserHandle.USER_OWNER, pkg.packageName);
        boolean uidError = false;
        if (dataPath.exists()) {
            // APK的data目录已经存在
            ...
        } else {
            // APK的data目录不存在，则通过Installd创建之
            int ret = createDataDirsLI(pkg.volumeUuid, pkgName, pkg.applicationInfo.uid,
                    pkg.applicationInfo.seinfo);
            if (ret < 0) {
                throw new PackageManagerException(INSTALL_FAILED_INSUFFICIENT_STORAGE,
                        "Unable to create data dirs [errorCode=" + ret + "]");
            }
            ...
        }
    }
    ...
    // 4. 设置Native Library
    if ((scanFlags & SCAN_NEW_INSTALL) == 0) {
        derivePackageAbi(pkg, scanFile, cpuAbiOverride, true /* extract libs */);
        if (isSystemApp(pkg) && !pkg.isUpdatedSystemApp() &&
                pkg.applicationInfo.primaryCpuAbi == null) {
            setBundledAppAbisAndRoots(pkg, pkgSetting);
            setNativeLibraryPaths(pkg);
        }
    } else {
        ...
        setNativeLibraryPaths(pkg);
    }
    ...
    // 5. 填充PMS中的数据
    synchronized (mPackages) {
        mSettings.insertPackageSettingLPw(pkgSetting, pkg);
        mPackages.put(pkg.applicationInfo.packageName, pkg);
        ...
        int N = pkg.providers.size();
        for (i=0; i<N; i++) {
            PackageParser.Provider p = pkg.providers.get(i);
            p.info.processName = fixProcessName(pkg.applicationInfo.processName,
                    p.info.processName, pkg.applicationInfo.uid);
            mProviders.addProvider(p);
            ...
        }

        N = pkg.services.size();
        for (i=0; i<N; i++) {
            PackageParser.Service s = pkg.services.get(i);
            s.info.processName = fixProcessName(pkg.applicationInfo.processName,
                    s.info.processName, pkg.applicationInfo.uid);
            mServices.addService(s);
            ...
        }

        N = pkg.receivers.size();
        for (i=0; i<N; i++) {
            PackageParser.Activity a = pkg.receivers.get(i);
            a.info.processName = fixProcessName(pkg.applicationInfo.processName,
                    a.info.processName, pkg.applicationInfo.uid);
            mReceivers.addActivity(a, "receiver");
            ...
        }

        N = pkg.activities.size();
        for (i=0; i<N; i++) {
            PackageParser.Activity a = pkg.activities.get(i);
            a.info.processName = fixProcessName(pkg.applicationInfo.processName,
                    a.info.processName, pkg.applicationInfo.uid);
            mActivities.addActivity(a, "activity");
        }
        ...
    }

    return pkg;
}
```

- 1 包名为“android”的APK就是**system/framework/framework-res.apk**，PMS中有几个专门的变量用于保存这个APK的信息：mPlatfromPackage用于保存该APK的**Package**数据结构、mAndroidApplicationInfo用于保存该APK的**ApplicationInfo**。

- 2 当**Package**对象创建以后，就需要将其纳入PMS的管辖范围，PMS有一个**mPackages**对象，保存的是包名到**Package**对象的映射，当一个APK顺利通过扫描过程之后，其**Package**对象便被添加到**mPackages**这个映射表中。在这一步，锁上**mPackages**对象，意味着需要对其相关的内容进行写操作，主要涉及以下方面：

  - 处理ShareUserId，如果APK有定义"android:ShareUserId"，则会为其创建一个ShareUserSetting对象，并将其纳入PMS的mShareUsers中

  - 生成PackageSetting对象，每一个包名都会对应一个PacageSetting对象，这个映射关系保存在PMS的**Settings.mPackages**中。PMS的Settings最终会序列化到**/data/system/packages.xml**文件中，前文分析的系统应用升级替换的逻辑，需要获取已经安装应用的信息，就是从**/data/system/packages.xml**文件中读取的

  - 打上SELinux标签，这是在Android引入SELinux以后才有的逻辑，每一个的静态的APK文件都会被打上一个SE Label，一个APK该打上什么类型的SE Label是由其签名信息决定的。在前文中，我们提到过**mFoundPolicyFile**就是**mac_permission.xml**文件，在这个文件中，保存了签名到签名类型的映射。笔者在AOSP源码上编译生成的 **out\target\product\generic_arm64\obj\ETC\mac_permissions.xml_intermediates\mac_permissions.xml**文件内容如下：

    ```xml
    <policy>
      <signer signature="308204a83082039...">
        <seinfo value="platform"/>
      </signer>
      <default>
       <seinfo value="default"/>
      </default>
    </policy>
    ```

    其中，signature就是签名，不同签名的值不一样，本例中，该签名的类型就是platform，其他签名的类型都是default。SELinxu在打标签的时候，就是根据seinfo来打上不同的标签。

- 3 生成APK的data目录，framework-res.apk比较特殊，它的data目录位于/data/system/，其他APK的data目录都位于/data/data/packageName下，packageName就是APK的包名，譬如com.yourname.test。

- 4 设置APK依赖的Native库，即so文件的目录。这一块逻辑比较复杂，笔者不予展开，在分析安装APK的过程时，再回过来理解如果处理APK所依赖的so文件。

- 5 该函数的最后一部分，就是填充PMS中的一些数据结构。每一个包的PackageSetting会填充到PMS.mPackages中，activity、provider、service、receiver四大组件的信息会填充PMS对应的数组中，当然还有permission、instrument等会填充到PMS中。

**至此，由scanDir()函数引发的一系列包扫描的过程就完成了，通过对包的解析得到一个包在内存中的数据结构Package，然后再对这个数据结构进行加工处理，将所有包的信息汇集到PMS这个包管理中心。**

> 本文中列举的包文件扫描，仅仅是一个大体的流程，包文件扫描的细节远不止这些，诸如包扫描的参数、特殊的扫描场景都是本文中没有涉及到的。读者在理解PMS的功能定位时，也可以适当地跳出细节，笼统来看，包扫描就是包管理者对管理对象设定的一套认证系统，只有管理对象通过认证，才能被纳入管理范围。同时，包管理者也是一个信息中心，它维护所有包的信息。

## 3.3 应用授权

包解析过后，PMS的Settings这个数据结构中聚合了所有包的信息以及所有权限信息，此时，需要对所有应用授权。整个授权机制的原理如下图所示：

<div align="center"><img src="/assets/images/packagemanager/6-packagemanager-permission-grant-mechanism.png" alt="Package Permission Grant Mechanism"/></div>

APK在清单文件中声明需要使用的权限，PMS设计了一套授权机制，用于判定是否授权以及授权类型。

Android中，有**权限持有者**和**权限申请者**两个角色，一个Android包可以扮演其中一种角色，或两种角色兼备。持有者通过设计权限来保护接口和数据，申请者如果要访问受保护的接口和数据时，需要事先声明，然后交由包管理者来判断是否要授权。

对于权限持有者而言，可以通过protectionLevel属性定义了权限的受保护级别，其取值主要有以下四种：

- **normal(0)**: 最普通的一类权限，只要申请使用这一类权限就授予。

- **dangerous(1)**: 较为危险的一类权限，譬如访问联系人、获取位置服务等权限，需要经过用户允许才授予。

- **signature(2)**: 如果申请者与该权限的持有者签名相同，则授予这类权限。

- **signatureOrPrivileged(18)**: 对**singature**的一个补充，权限申请者与持有者签名相同，或者申请者是位于/system/priv-app目录下的应用，则授予这类权限。在早期的Android版本，所有系统应用都位于/system/app目录下，其定义为**signatureOrSystem(3)**，但该定义已经过时了；当Android引入了/system/priv-app目录以后，就将这一类保护级别重新定义为**signatureOrPrivileged(18)**。

除了以上最主要的四类保护级别，android.content.pm.PermissionInfo中还定义了其他保护级别，读者可以自行参考。笔者截取了framework/base/core/res/AndroidManifest.xml文件中的部分权限定义：

```xml
    <!-- 读取联系人，权限保护级别为dangerous -->
    <permission android:name="android.permission.READ_CONTACTS"
        android:permissionGroup="android.permission-group.CONTACTS"
        android:label="@string/permlab_readContacts"
        android:description="@string/permdesc_readContacts"
        android:protectionLevel="dangerous" />
    <!-- 网络访问， 权限保护级别为normal -->
    <permission android:name="android.permission.INTERNET"
        android:description="@string/permdesc_createNetworkSockets"
        android:label="@string/permlab_createNetworkSockets"
        android:protectionLevel="normal" />
    <!-- USB管理，权限保护界别为signatureOrPrivileged -->
    <permission android:name="android.permission.MANAGE_USB"
        android:protectionLevel="signature|privileged" />
    <!-- 账户管理，权限保护级别为signature -->
    <permission android:name="android.permission.ACCOUNT_MANAGER"
        android:protectionLevel="signature" />
```

以上这些权限的持有者其实就是**framework-res.apk**，这个APK的签名是**platform**，运行在系统进程(system_process)之中，可以理解为系统权限，几乎所有应用都要申请其中若干项权限。当然，一个应用可以自定义权限，设计其权限保护级别，供其他申请者所用。

有了上面的权限级别限制，就可以理解，部分权限需要申请者满足一定的条件才能被授予，从Android M(6.0)开始，对最终授予的权限进行了分类：

- **install**：安装时授予的权限。**normal**、**signature**、**signatureOrPrivilege**的授予都属于这一类。

- **runtime**：运行时由用户决定是否授予的权限。在Android M(6.0)以前，**dangerous**的权限属于**install**类型，但从Android M(6.0)以后，**dangerous**的权限改为属于**runtime**一类了。在使用这类权限时，会弹出一个对话框，让用户选择是否授权。

**注意**，授权类型是**Android M(6.0)**才引进的，之前只有是否授权的区分。之所以做授权类型的区分，是为了适应多用户使用的场景，**install**类型的授权，对所有用户都是一样的；**runtime**类型的授权，不同用户使用的选择不一样，譬如一个用户在使用的会授予某个应用访问联系人数据的权限，但另一个用户使用时会选择拒绝授权。

在深入分析应用授权的逻辑之前，我们先介绍一下授权机制涉及到的数据结构：

<div align="center"><img src="/assets/images/packagemanager/7-packagemanager-permission-grant-class-diagram.png" alt="Package Permission Grant Class Diagram"/></div>

- **BasePermission**：权限持有者所定义的每一项权限都会生成一个BasePermission，所有BasePermission都聚合在PMS的Settings中。BasePermission有三种类型: NORMAL、BUILTIN、DYNAMIC。

- **PackageSetting**: 每一个解析成功的包都会生成一个PackageSetting，所有的PackageSetting都聚合在PMS的Settings中。PackageSetting继承了其祖宗**SettingBase**的属性**mPermissionsState**，这个属性表示一个包的授权状态。

- **PermissionsState(注意，这是复数)**：聚合了包中所有权限的授予状态，在多用户的场景下，不同用户的授权情况不同，因此要区分出一个权限针对每个用户的授予情况，为此设计了一个数据封装类**PermissionData(注意，这是单数)**，记录了一个BasePermission与多个用户mUserState之间的关系。每一个用户的权限授予状态用**PermissionState(注意，这是单数)**来记录。

> 理解应用授权机制的数据结构设计，可以结合日常生活中的门禁系统。一个大厦里面有很多房间，进入不同的房间需要获得通过门禁的权限，每一个房间的门禁就可以理解为BasePermission，所有的门禁权限都记录在大厦管理者的数据中心，这个数据中心就可以理解为PMS的Settings。每一个用户来到大厦，都会被登记，登记的记录就是PackageSetting。
>
> 用户会申请要进入哪些房间，待管理中心分配，最后，用户会拿到的门禁卡，表示可以进入哪些房间。不同用户需要进入和有权进入的房间通常是不同的，譬如涉及大厦安全的监控房间，就不让访客进入，这就决定了对不同用户而言，门禁卡开通的权限不一样。门禁卡所对应的就是PermissionsState。
>
> 假设大厦临时换了一套管理规定，之前某个用户有权进入某个房间，在临时的管理规定下变成了无权进入。同一个房间，在不同管理规定下，对一个用户开放的权限是不同的，这个信息被记录下来，就是PermissionData。这样一来，同一张门禁卡，面对同一张门，在不同的管理规定下，打开门的情况是不一样的。
>
> 不同的管理规定，其实就是Android中的多用户使用情况的体现，不同用户的使用规则是不同的，对于同一个应用而言，不同用户使用下的授权情况会有差异。

有了以上应用授权的一些基础知识，我们再来分析代码会稍微轻松一点。

在包扫描完成以后，PMS会调用**updatePermissionsLPw()**函数，来更新所有APK的授权状态。

```java
private void updatePermissionsLPw(String changingPkg,
        PackageParser.Package pkgInfo, int flags) {
    ... // 此处省略大段逻辑。需要删除没有归属的BasePermission，
    // 如果一个BasePermission找不到其关联的包，则需要删除之

    // 遍历包扫描的结果，依次对每个包进行授权。
    // PMS初始化调用该函数时，传入的pkgInfo为null。
    if ((flags&UPDATE_PERMISSIONS_ALL) != 0) {
        for (PackageParser.Package pkg : mPackages.values()) {
            if (pkg != pkgInfo) {
                grantPermissionsLPw(pkg, (flags&UPDATE_PERMISSIONS_REPLACE_ALL) != 0,
                        changingPkg);
            }
        }
    }

    if (pkgInfo != null) {
        grantPermissionsLPw(pkgInfo, (flags&UPDATE_PERMISSIONS_REPLACE_PKG) != 0, changingPkg);
    }
}
```

该函数的调用场景比较多，譬如安装、卸载、更新系统应用时，都会调用到。此处分析流程是处于PMS构造时调用的，在开机扫描完所有的包后，便会掉用该函数，一次性来更新所有包的权限。

其实，该函数仅仅是完成授权的准备工作，需要保证所有的扫描出来的权限都有归属，才能开始授权。真正的授权函数是**grantPermissionsLPw()**，带上**LP**后缀表示需要获取**mPackages**这个锁，多了一个**w**表示需要对**mPackages**进行写操作。

```java
private void grantPermissionsLPw(PackageParser.Package pkg, boolean replace,
        String packageOfInterest) {
    // 1. 初始化授权相关的数据
    final PackageSetting ps = (PackageSetting) pkg.mExtras;
    if (ps == null) {
        return;
    }
    // 申请者的授权状态PermissionsState，在后文的逻辑中，会以origPermissions这个变量来表示
    PermissionsState permissionsState = ps.getPermissionsState();
    PermissionsState origPermissions = permissionsState;
    ...
    if (replace) {
        // 如果replace为true，表示包权限需要更新
        // PackageSettings.installPermissionsFixed这个布尔变量表示
        // 包的**install**类型的权限已经确定下来，在安装成功后，该变量会被置为true
        // 此处，需要重新更新权限，故又将其置为false
        ps.installPermissionsFixed = false;
        if (!ps.isSharedUser()) {
            origPermissions = new PermissionsState(permissionsState);
            permissionsState.reset();
        }
    }
    ...
    // 2. 遍历所有申请的权限，依次判断是否授权
    final int N = pkg.requestedPermissions.size();
    for (int i=0; i<N; i++) {
        // name表示待申请的权限名
        final String name = pkg.requestedPermissions.get(i);
        // bp表示待申请权限的数据结构，bp根据name从已有的权限列表中获取的
        final BasePermission bp = mSettings.mPermissions.get(name);
        if (bp == null || bp.packageSetting == null) {
            // 如果没有匹配到bp，则说明当前系统中还不存在name指定的权限
            if (packageOfInterest == null || packageOfInterest.equals(pkg.packageName)) {
                Slog.w(TAG, "Unknown permission " + name
                        + " in package " + pkg.packageName);
            }
            continue;
        }

        final String perm = bp.name;
        boolean allowedSig = false;
        int grant = GRANT_DENIED;
        ...
        // 根据所申请权限的保护级别，确定授权类型
        final int level = bp.protectionLevel & PermissionInfo.PROTECTION_MASK_BASE;
        switch (level) {
            case PermissionInfo.PROTECTION_NORMAL: {
                grant = GRANT_INSTALL;
            } break;

            case PermissionInfo.PROTECTION_DANGEROUS: {
                if (pkg.applicationInfo.targetSdkVersion <= Build.VERSION_CODES.LOLLIPOP_MR1) {
                    grant = GRANT_INSTALL_LEGACY;
                } else if (origPermissions.hasInstallPermission(bp.name)) {
                    grant = GRANT_UPGRADE;
                } else if (mPromoteSystemApps
                        && isSystemApp(ps)
                        && mExistingSystemPackages.contains(ps.name)) {
                    grant = GRANT_UPGRADE;
                } else {
                    grant = GRANT_RUNTIME;
                }
            } break;

            case PermissionInfo.PROTECTION_SIGNATURE: {
                allowedSig = grantSignaturePermission(perm, pkg, bp, origPermissions);
                if (allowedSig) {
                    grant = GRANT_INSTALL;
                }
            } break;
        }

        // 3. 根据授权类型，更新包的PermissionsState
        if (grant != GRANT_DENIED) {
            // 小插曲，对于Data分区的应用而言，原则上是不会授予新的install类型的权限
            if (!isSystemApp(ps) && ps.installPermissionsFixed) {
                if (!allowedSig && !origPermissions.hasInstallPermission(perm)) {
                    if (!isNewPlatformPermissionForPackage(perm, pkg)) {
                        grant = GRANT_DENIED;
                    }
                }
            }

            switch (grant) {
                case GRANT_INSTALL: {
                    // 收回所有已授予的runtime权限。因为runtime可能在新版本中变成install类型
                    // runtime是面向多用户的，所以涉及到runtime授权时，都会有一个循环遍历所有的用户
                    for (int userId : UserManagerService.getInstance().getUserIds()) {
                        if (origPermissions.getRuntimePermissionState(
                                bp.name, userId) != null) {
                            origPermissions.revokeRuntimePermission(bp, userId);
                            origPermissions.updatePermissionFlags(bp, userId,
                                  PackageManager.MASK_PERMISSION_FLAGS, 0);
                            changedRuntimePermissionUserIds = ArrayUtils.appendInt(
                                    changedRuntimePermissionUserIds, userId);
                        }
                    }
                    // 授予install类型的权限
                    if (permissionsState.grantInstallPermission(bp) !=
                            PermissionsState.PERMISSION_OPERATION_FAILURE) {
                        changedInstallPermission = true;
                    }
                } break;

                case GRANT_INSTALL_LEGACY: {
                    if (permissionsState.grantInstallPermission(bp) !=
                            PermissionsState.PERMISSION_OPERATION_FAILURE) {
                        changedInstallPermission = true;
                    }
                } break;

                case GRANT_RUNTIME: {
                    for (int userId : UserManagerService.getInstance().getUserIds()) {
                        PermissionState permissionState = origPermissions
                                .getRuntimePermissionState(bp.name, userId);
                        final int flags = permissionState != null
                            ? permissionState.getFlags() : 0;
                        if (origPermissions.hasRuntimePermission(bp.name, userId)) {
                            if (permissionsState.grantRuntimePermission(bp, userId) ==
                                    PermissionsState.PERMISSION_OPERATION_FAILURE) {
                                changedRuntimePermissionUserIds = ArrayUtils.appendInt(
                                    changedRuntimePermissionUserIds, userId);
                            }
                        }
                        permissionsState.updatePermissionFlags(bp, userId, flags, flags);
                }
               } break;

               case GRANT_UPGRADE: {
                   // 先回收之前授予的install权限，再重新授予runtime权限
                   ...
               }

               default: {
                   // 如果进入这个分支，表示并没有拒绝授权，但权限又没有真正授予给申请者
                   // 因为当时申请的权限还不存在，即便后来有了待申请的权限，也不会授予给申请者
                   if (packageOfInterest == null
                           || packageOfInterest.equals(pkg.packageName)) {
                       Slog.w(TAG, "Not granting permission " + perm
                               + " to package " + pkg.packageName
                               + " because it was previously installed without");
                   }
               } break;
           }
       else {
           // 拒绝授权，则需要回收已经授予的权限
           ...
       }
    }
    if ((changedInstallPermission || replace) && !ps.installPermissionsFixed &&
            !isSystemApp(ps) || isUpdatedSystemApp(ps)){
        ps.installPermissionsFixed = true;
    }
    for (int userId : changedRuntimePermissionUserIds) {
        mSettings.writeRuntimePermissionsForUserLPr(userId, false);
    }
}
```

先从整体来思考一下这个函数，该函数完成对一个包授权，接收三个输入参数：

函数参数 | 说明
--- | ---
**pkg** | 包解析器解析出来的对象PackageParser.Package。这就是待授权的包。
**replace** | 是否需要替换已有包的权限。初始化PMS时，如果不是OTA升级系统版本，则该参数为false。
**packageOfInterest** | 感兴趣的包，主要是为了打印日志。不影响函数的主体逻辑。

在调用这个函数之前，所有包的信息都写入了PMS的Settings中，每一个包都有一个**PermissionsState**对象，用于记录授权状态。在调用这个函数之后，包的**PermissionsState**对象的数据会更新。该函数其实就是Android的包授权规则的实现函数，要更新的数据就是**PermissionsState**对象。授权规则体现在函数的逻辑中：

1. 初始化授权相关的数据：

    - **origPermissions**：表示一个包已有的授权状态，包扫描完后，这个数据结构就已经构建完毕了。
    - **changedRuntimePermissionUserIds**：表示已经授予的**runtime**类型的权限发生了变化的那些用户。
    - **changedInstallPermission**：表示已经授予的**install**类型的权限发生的变化，默认为false。
    - **PackageSettings.installPermissionsFixed**: 表示包的**install**类型的权已经确定。如果传入的函数参数**replace**为true，则意味着需要对**install**类型的授权进行调整，故会将此变量重新置为false。

2. 遍历所有申请的权限，根据所申请权限的保护级别(protectionLevel)，会得到几种结果：

    - **GRANT_INSTALL**：对于Normal级别的权限而言，都是在安装时授予给申请者的。对于Signature级别的权限，如果签名匹配或者满足Previlege系统应用的要求，则也是在安装时授予给申请者的。

    - **GRANT_INSTALL_LEGACY**：带上**LEGACY**表示这属于遗留的安装权限，在Android M(6.0)之前，Dangerous级别的权限都是授予**install**类型，到Android M(6.0)之后，Dangerous级别的权限都是以**runtime**类型来授予。这是Android为了保证向下兼容的设计：对于一个应用程序而言，如果是基于Android M(6.0)之前的SDK进行开发，而且申请了Dangerous级别的权限，这一类权限就是以**GRANT_INSTALL_LEGACY**类型来授予。

    - **GRANT_UPGRADE**: 与**GRANT_INSTALL_LEGACY**一样，也是为了向下兼容。如果应用程序没有指明一定要运行在Android M(6.0)以前的版本，那申请的Dangerous级别的权限，将会以**GRANT_UPGRADE**来授权，表示对于Dangerous权限，之前授权为**install**类型的，已经记录在PMS的Settings中，现在整个系统通过OTA升级到Android M(6.0)了，需要将**install**类型的授权升级为**runtime**类型。

    - **GRNAT_RUNTIME**：如果运行在Android M(6.0)上的应用程序申请了Dangerous权限，则以**runtime**类型来授权。

    - **GRANT_DENIED**：拒绝授权。有两大类情况会拒绝授权：其中一类是申请保护级别为SignatureOrPrivelege的权限，但不满足签名匹配或为系统应用的约束条件，则拒绝授权。另一类，在下文中见。

3. 根据授权类型来更新授权状态PermissionsState。如果需要授予权限，则会根据授权类型区别对待，最开始初始化的两个变量changedInstallPermission和changedRuntimePermissionUserIds在这一个步骤中可能会被更新。

    如果拒绝授权，则需要收回。这里就出现了另一类拒绝授权的场景：对于一个Data分区的普通应用而言，之前申请的权限不存在，但现在申请的权限又有了，则仍然拒绝授权给这个普通应用，除非这个普通应用申请的权限时平台新增的权限。这一点，其实不难理解，譬如一个普通应用A，申请了普通应用B定义的权限，A先于B安装，那么，在A安装的时候，所申请的权限还不存在。B安装以后，即便权限有了，也不会再重新授予给A。如果普通应用A申请的是一个Android平台自身添加的权限，则会授予。

> 如果读者还没有接触到Android M(6.0)之后的代码，那应用授权机制还不至于这么复杂，因为Android M(6.0)对扩展了授权类型，并做了大量向下兼容的设计。所以，这段代码读起来总是不那么利索。其实，越往Android高版本学习，就越能看到这些向下兼容的代码，设计上总是不那么优美，但又无处不体验向下兼容的精神。
>
> 没有一个系统一开始就兼顾到了所有后续发展策略，绝对的优美设计或许只是停留在一个时间段。或许更加好的，只是那些活下来的、不断发展的代码。


# 4 包查询服务

在管理所有包的同时，包管理者需要对外提供服务，诸如获取包的信息、安装或删除包、解析Intent等，都是包管理者在Android世界的职能。

本节先介绍包管理者的服务方式，再分析一个最常见的包查询实例。

## 4.1 服务方式

包管理者以什么形式对外提供服务呢？在写应用程序时，我们通常会利用应用自身的上下文环境Context来获取包管理服务：

```java
// 获取一个PackageManager的对象实例
PackageManager pm = context.getPackageManager();
// 通过PackageManager对象获取指定包名的包信息
PackageInfo pi = pm.getPackageInfo("com.android.contacts", 0);
```

这么一段简单的代码，其实蕴含着很多深意：

1. 前文介绍的PMS和其管理的各种数据结构，都是运行在系统进程之中。在应用进程中获取的PackageManager对象，只是PMS在应用进程中的一个代理，不同的应用进程都不同的代理，意味着不同应用进程中的PackageManager对象是不同的，但管理者PMS只有一个。

2. 运行在应用进程中的PackageManager要与运行在系统进程中的PMS进行通信，通信的手段是什么吗？自然是Android中最常见的Binder机制。因此，会有一个IPackageManager.aidl文件，用于描述两者通信的接口。
另外，应用进程中的PackageInfo对象，在上文分析“包信息体”的时候，我们已经见过它，还记得吗？包解析后，需要跨进程传递的数据结构都实现了Parcelable接口，PackageInfo其实就是由系统进程传递到应用进程的对象。

不同应用进程通过Binder机制与PMS通信的过程如下图：

<div align="center"><img src="/assets/images/packagemanager/8-packagemanager-ipackagemanager-aidl.png" alt="PMS Binder Transaction"/></div>

PMS作为包管理的最核心组成部分，伴随着系统的启动而创建，并一直运行系统进程中。当应用程序需要获取包管理服务时，会生成一个PackageManager对象与PMS进行通信。在包解析时就会生成包信息，即XXXInfo这一类数据结构，PMS会将这些数据传递给需要的应用进程。

> 管理者对内设计了复杂的管理机制，对外封装了简单的使用接口。这种设计在Android中大量出现，ActivityManagerService、WindowManagerService、PowerManagerService等，基本所有的系统服务都遵循这种设计规范。对于应用程序而言，不需要关心管理者的实现原理，只需要理解接口的使用场景。

应用进程通过Binder接口获取包管理服务，这仅仅是包管理者提供服务的概貌，接下来可以更深入地思考一个问题：通过Context就能获取到PackageManager，那么PackageManager对象是如何生成到应用进程的运行环境中去的呢？我们通过源码来回答。

**Context.getPackageManager()**函数的实现如下：

```java
// frameworks/base/core/java/android/app/ContextImpl.java
public PackageManager getPackageManager() {
    if (mPackageManager != null) {
        return mPackageManager;
    }

    // 从ActivityThread获取了PackageManager对象
    IPackageManager pm = ActivityThread.getPackageManager();
    if (pm != null) {
        // 通过ApplicationPackageManager对进行了一层封装
        return (mPackageManager = new ApplicationPackageManager(this, pm));
    }

    return null;
}
```

**ActivityThread.getPackageManager()**函数实现如下：

```java
// frameworks/base/core/java/android/app/ActivityThread.java
public static IPackageManager getPackageManager() {
    if (sPackageManager != null) {
        return sPackageManager;
    }
    // 早在系统进程(SystemServer)启动PMS时，就将PMS添加到了系统服务中
    // 因此，通过ServiceManager便可以获取到包服务。
    IBinder b = ServiceManager.getService("package");
    sPackageManager = IPackageManager.Stub.asInterface(b);
    return sPackageManager;
}
```

通过Context获取PackageManager最终得到的对象是ApplicationPackageManager，它是PackageManager的子类，其实就是对PackageManager的一个封装，目的是为了方便应用程序编程。

**现在，可以完整的梳理一下包管理的服务方式了：**

1. 全局定义了**IPackageManager**接口，描述了包管理者对外提供的功能；运行在系统进程中的PMS实现了**IPackageManager**接口，作为包管理的服务端；客户端通过**IPackageManager**接口请求包服务；

2. 为了方便客户端使用包服务，Android做了多层封装。应用进程作为客户端，通过**PackageManager**便可使用包服务，客户端实际存在的对象是**ApplicationPackageManager**，它封装了**IPackageManager**的所有接口；

3. **在应用进程看来，客户端和服务端的概念是模糊的，明确的只有运行环境的概念，即Context。包服务就存在于应用进程的运行环境中，需要时直接拿出来使用即可**。

> “运行环境(Context)”是Android的设计哲学之一，Android有意弱化进程，强化运行环境，这是面向应用开发者的设计。运行环境是什么并不是一个好回答的问题，可以将其类比为我们的工作环境，当我们需要办公设备时，只需要向管理部门申请，并不需要关心办公设备如何采购，办公设备对一般的工作人员而言，就像是工作环境中天然存在的东西。

## 4.2 Intent的解析

Android中，使用Intent来表达意图，最终会有一个响应者。当系统产生一个Intent后，如何找到它的响应者呢？这需要对Intent进行解析。作为所有包信息管理者的中枢，PMS自然有义务承担解析Intent的责任。要解析Intent，就需要先了解Intent的结构，标识一个Intent身份的信息由两部分构成：

- **主要信息**：Action和Data。Action用于表明Intent所要执行的操作，譬如ACTION_VIEW，ACTION_EDIT; Data用于表明执行操作的数据，譬如联系人数据，数据是以URI来表达的。再举两个Action和Data成对出现的例子：

    ACTION_VIEW: content://contacts/people/1  # 表示查看联系人数据库中，ID为1的联系人信息

    ACTION_DIAL: tel:119    # 表示拨打电话给119

    以上例子中的URI并不一样，完整的URI格式为`scheme://host:port/path`。

- **次要信息**：除了主要的标记信息，Intent还可以附加很多额外的信息，Category，Type，Component和Extra：

	- Category表示Intent的类别，譬如CATEGORY_LAUNCHER表示要对属于桌面图标这一类的对象执行操作；
	- Type表示Intent所操作的数据类型，就是MIMEType，譬如要操作PNG图片，那Type就可以设置为*png*；
	- Component表示Intent要操作的对象；
	- Extra表示Intent所传递的数据，这些数据都实现了Parcelable接口。

Intent的身份信息，其实就是Android的一种设计语言，譬如“打电话给119”，只需要发出Action为*ACTION_DIAL*，URI为*tel:119*的Intent即可，剩下的就交由Android系统去理解这个意图。任何组件只要按照规则发声，都会被Android系统正确的理解。

根据解析Intent方式的不同，可以将Intent分为两类：

- **显式(Explicit)**: 明确指名需要谁来响应Intent。这一类Intent的解析过程比较简单。

- **隐式(Implicit)**：由系统找到合适的目标来响应Intent。这一类Intent的解析过程比较复杂，由于目标不明确，所以需要经过层层筛选才能找到最合适的响应者。

> 之所以Intent的信息有**主次之分**，是因为解析Intent的规则需要有一个依据，主要信息是最能表达意图的，而次要信息则是解析规则的一个补充。这就像大家在做自我介绍的时候，总是先说姓名、籍贯这些主要的信息，再额外补充爱好、特长这些次要信息，这样一来在和其他人交朋友的时候，其他人就可以先根据姓名、籍贯直接锁定的我。如果我们只介绍爱好、特长，那别人锁定的范围就比较广，因为有相同爱好或特长的人比较多。
>
> 之所以Intent有**显隐之分**，是因为解析Intent的方式不同，如果我指定要和某某人交朋友，那发出的这一类请求，就是**显式**的Intent；如果没有指定交朋友的对象，只是说找到跟我爱好相同的人，那发出的这一类请求，就是**隐式**的Intent。对待这两种Intent显然有不同的解析方式。
>
> 如同“运行环境(Context)”一样，Intent也是面向应用程序的设计，同样是弱化了进程的概念。应用程序只需表明“我想要什么”，不需要关心所要的东西在什么地方，如何找到所要的东西。Intent是Android通信的手段之一，可以承载要传递的信息，至于信息怎么从发起进程传递到目标进程，应用程序可以毫不关心。

Intent最后的响应者是一个Android组件，Android的组件都可以定义IntentFilter，还记得前文中包解析器的类图结构吗？每一个Component类中都有一个IntentInfo对象的数组，而IntentInfo则是IntentFilter的子类。既然一个Android组件可以定义多个IntentFilter，那么，Intent想要匹配到最终的组件，则需要通过组件所定义的所有IntentFilter：

<div align="center"><img src="/assets/images/packagemanager/9-packagemanager-intent-and-intentfilter.png" alt="Intent and IntentFilter"/></div>

多个IntentFilter之间是**“或”**的关系，哪怕其他所有的IntentFilter都匹配失败，只要有一个IntentFilter通过，最终Intent还是找到了可以响应的组件。

每一个IntentFilter就像是一个定义了白名单规则的过滤器，只有满足白名单的要求才会放行。IntentFilter的过滤规则，其实就是针对Intent的身份信息的匹配规则，当Intent的身份信息与IntentFilter所规定的要求匹配上，则允许通过；否则，Intent就被过滤掉了。IntentFilter的过滤规则包含以下三个方面：

- **Action**: 每一个IntentFilter可以定义零个或多个&lt;action&gt;标签，如果Intent想要通过这个IntentFilter，则Intent所辖的Action需要匹配其中至少一个。

- **Category**： 每一个IntentFilter可以定义零个或多个&lt;category&gt;标签，如果Intent想要通过这个IntentFilter，则Intent所辖的Category必须是IntentFilter所定义的Category的子集，才能通过IntentFilter。譬如Intent设置了两个Category：CATEGORY_LAUNCHER和CATEGORY_MAIN，只有那些至少定义了这两项Category的IntentFilter，才会放行该Intent。

  启动Activity时，会为Intent设置默认的Category，即CATEGORY_DEFAULT。目标Activity需要添加一个category为CATEGORY_DEFAULT的IntentFilter来匹配这一类隐式的Intent。

- **Data**：每一个IntentFilter可以定义零个或多个&lt;data&gt;，数据可以通过类型(MIMEType)和位置(URI)来描述，如果Intent想要通过这个IntentFilter，则Intent所辖的Data需要匹配其中至少一个。

在了解了Intent的身份信息和IntentFilter的规则定义之后，就可以介绍Intent解析的过程了，这里借用类图来示例一下Intent解析过程中相关的数据结构：

<div align="center"><img src="/assets/images/packagemanager/10-packagemanager-intent-resolver-class-diagram.png" alt="Intent Resolver Class Diagram"/></div>

PMS中有四大组件的Intent解析器，分别是**ActivityIntentResolver**用于解析发往Activity或Broadcast的Intent，**ServiceIntentResolver**用于解析发往Service的Intent，**ProviderIntentResolver**用于解析发往Provider的Intent，系统每收到一个Intent的解析请求时，就会使用应的解析器，它们都是**IntentResolver**的子类。

**IntentResolver**的职能就是解析Intent，它包含了所有的**IntentFilter**，同时有一个重要的成员函数**queryIntent()**，接收Intent作为参数，返回查询结果：一个ResolveInfo对象的数组。因为可能有多个组件来响应一个Intent，所以返回结果是一个数组。可想而知，该函数就是针对输入的Intent，按照前文所述的过滤规则，逐个与IntentFilter进行匹配，直到找到最终的响应者，便加入返回结果的列表。

**ResolveInfo**是最终的Intent解析结果的数据结构，并不复杂，就是各类组件信息的一个包装。需要注意的是，其中的组件信息ActivityInfo、ProviderInfo、ServiceInfo只有一个不为空，这样就可以区分不同组件的解析结果。


# 5 APK的安装过程


# 6 APK的卸载过程

---

# 参考文献

1. 应用程序清单文件介绍: <https://developer.android.com/guide/topics/manifest/manifest-intro.html>

2. Intent Filters介绍: <https://developer.android.com/guide/components/intents-filters.html>
