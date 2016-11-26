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

有了上面的权限级别限制，就可以理解，部分权限需要申请者满足一定的条件才能被授予，最终授予的权限有两种类型：

- **install**：安装时授予的权限。**normal**、**signature**、**signatureOrPrivilege**的授予都属于这一类。

- **runtime**：运行时由用户决定是否授予的权限。在Android M(6.0)以前，**dangerous**的权限属于**install**类型，但从Android M(6.0)以后，**dangerous**的权限改为属于**runtime**一类了。在使用这类权限时，会弹出一个对话框，让用户选择是否授权。

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
private void grantPermissionsLPw(PackageParser.Package pkg, boolean replace,
        String packageOfInterest) {
    final PackageSetting ps = (PackageSetting) pkg.mExtras;
    if (ps == null) {
        return;
    }
    // 申请者的授权状态PermissionState
    PermissionsState permissionsState = ps.getPermissionsState();
    PermissionsState origPermissions = permissionsState;
}
```

## 系统就绪

systemReady()


# 包查询服务


# APK的安装过程

---

# 参考文献

1. [应用程序清单文件介绍]<https://developer.android.com/guide/topics/manifest/manifest-intro.html>
2.
