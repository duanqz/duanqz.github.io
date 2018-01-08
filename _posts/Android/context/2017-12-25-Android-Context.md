---
layout: post
category: Android启智观
title: Android Context的设计思想和源码分析
tagline:
tags:  [Android Context]
---

做了好些年Android，终于可以聊一聊既熟悉又陌生的Context了，每个刚入门的Android开发人员都会接触到它；然而要读懂Context的设计哲学，却又要经过好多轮的认知升级。很多时候，大家是感知不到Context的存在的，笔者最开始“被迫”使用Context，是在自定义控件的时候，布局中有一个按钮，点击一次就发送一次广播，其代码片段如下所示：

```java
public class CustomLayout extends LinearLayout implements View.OnClickListener {
    private Context mContext;
    private Button mBtnBroadcast;

    // 1. 强制传入Context
    public CustomLayout(Context context) {
        super(context);
        LayoutInflater.from(context).inflate(R.layout.custom_layout, this);
        mContext = context;
        mBtnBroadcast = (Button) findViewById(R.id.btn_broadcast);
        mBtnBroadcast.setOnClickListener(this);
    }

    public void onClick(View v) {
        ...
        // 2. 通过Context发送广播
        mContext.sendBroadcast(intent);
    }
}
```

之所以说“被迫”使用Context，是因为：1. 构造函数就强制要传入Context，否则会导致编译报错；2. 在点击按钮发送广播时，又必须使用Context，于是乎，又“被迫”设计一个对象属性`mContext`来保存外部传入的Context。各种疑问涌上心头：

- 好不容易想实现控件的代码解耦，为什么要把Context传来传去呢？
- 为什么不能像在Activity中一样，直接调用sendBroadcast()就可以了呢？
- 通过Context可以调用到很多Android接口，譬如**getString(), getColor(), startActivity()**等等，它到底是何方神圣呢？

本文会结合Context的设计思想和源码分析来进行解构。

# 1. Context的设计思想

## 1.1 面向应用程序的设计

Android有意淡化进程的概念，在开发一个Android应用程序时，通常都不需要关心目标对象运行在哪个进程，只需要表明意图(Intent)，譬如拨打电话、查看图片、打开链接等；也不需要关心系统接口是在哪个进程实现的，只需要通过Context发起调用。对于一个Android应用程序而言，Context就像运行环境一样，无处不在。有了Context，一个Linux进程就摇身一变，成为了Android进程，变成了Android世界的公民，享有Android提供的各种服务。那么，一个Android应用程序需要一些什么服务呢？

- 获取应用资源，譬如：drawable、string、assets
- 操作四大组件，譬如：启动界面、发送广播、绑定服务、打开数据库
- 操作文件目录，譬如：获取/data/分区的数据目录、获取sdcard目录
- 检查授予权限，譬如：应用向外提供服务时，可以判定申请者是否具备访问权限
- 获取其他服务，有一些服务有专门的提供者，譬如：包管理服务、Activity管理服务、窗口管理服务

在应用程序中，随处都可访问这些服务，这些服务的访问入口就是Context。Android对Context类的注解是：

> Interface to global information about an application environment.  This is
> an abstract class whose implementation is provided by the Android system. 
> It allows access to application-specific resources and classes, as well as
> up-calls for application-level operations such as launching activities,
> broadcasting and receiving intents, etc.

其意为：Context是一个抽象类，提供接口，用于访问应用程序运行所需服务，譬如启动Activity、发送广播、接受Intent等。Android是构建在Linux之上的，然而对于Android的应用开发者而言，已经不需要关心Linux进程的概念了，正是因为有了Context，为应用程序的运行提供了一个Android环境，开发者只需要关心Context提供了哪些接口。

## 1.2 关于Decorator设计模式

在类的世界里面，要为一个类增加新的功能，最直接的方式就是**继承**，子类可以基于父类进行扩展。然而，当要增加的功能维度有很多，并且功能相互叠加的时候，要扩展的子类会变得非常多。

> 举个例子，基类是衣服，需求是分别生产防水、透气和速干的三个不同功能的衣服，便会扩展出三个子类：防水衣服、透气衣服和速干衣服。如果又有新的需求，即防水又速干，便会扩展出一个新的子类：防水速干衣服。然后，又有新的需求，即保暖又速干，这可能会扩展出两个子类：保暖衣服和保暖速干衣服。长此以往，市场需求不断变化，要扩展的类就会越来越多。

在GOF设计模式里面，把**继承**看成**静态**的类扩展，扩展功能的增多会导致子类膨胀。为了有效缓解这种情况，便产生了**动态**的类扩展：`修饰器模式(Decorator Pattern)`，先上UML图：

<div align="center"><img src="/assets/images/context/1-context-decorator-design-pattern-uml.png" /></div>

**Decorator**就是所谓的修饰器，包装了(Wrapper)一个**Component**类型对象，修饰器可以在已有**Component**的基础上，增加新的**属性(addedState)**和**行为(addedBehavior)**，从而形成不同的**ConcreteDecorator**。**Decorator**通过包装的手段，在外围扩展了**Component**的功能。
说到这里，读者们一定心生诧异，实现不同扩展功能的**ConcreteDecorator**，还是得**继承**实现多个不同子类啊！确实如此，扩展不同维度的功能需要实现不同的子类，但要实现这些功能的组合，却不需要新的子类了，因为一个修饰器可以修饰另外一个修饰器，通过修饰器的叠加便可实现功能的组合。

> 还是上面的例子，基类是衣服，有三个修饰器：防水、透气和速干，在这三个修饰器的包装下，便可生成三种不同的衣服：防水衣服、透气衣服和速干衣服。如果又有新需求，即防水又速干，只需要在防水衣服上再叠加一个速干修饰器，便生成了防水速干衣服。然后，又有新需求，即保暖又速干，这时，只需要增加一个修饰器：保暖，将这个修饰器叠加到速干衣服上，便可生成保暖速干衣服。这样一来，便能有效缓解类的膨胀。

理解Decorator模式，有助于大家理解Context类簇的设计，前文说过Context是一个抽象类，围绕Context还有很多实现类，这些类的结构设计就是Decorator模式。

## 1.3 Context类簇的设计

先奉上Context类簇的类图如下：

<div align="center"><img src="/assets/images/context/2-context-class-diagram.png" /></div>

一个典型的Decorator模式，基类**Context**定义了各种接口，**ContextImpl**负责实现接口的具体功能。对外提供使用时，**ContextImpl**需要被包装(Wrapper)一下，这就有了**ContextWrapper**这个修饰器。修饰器一般只是一个传递者，修饰器所有的方法实现都是调用具体的实现类**ContextImpl**，所以修饰器**ContextWrapper**需要持有一个**ContextImpl**的引用。

修饰器存在的价值是为了扩展类的功能，**Context**已经提供了丰富的系统功能，但仍不能满足最终应用程序编程的需要，因此Android又扩展了一些修饰器，包括**Application**、**Activity**和**Service**。虎躯一震，这些东西竟然就是**Context**，原来**Context**真的是无处不在啊！在**Activity**中调用startActivity启动另外的界面，原来就是通过父类**Context**发起的调用！

**Application**扩展了应用程序的生命周期，**Activity**扩展了界面显示的生命周期，**Service**扩展了后台服务的生命周期，它们在父类**Context**的基础上进行了不同维度的扩展，同时也仍可以将它们作为**Context**使用，这可以解释很多**Applicaiton、Activity和Service**的使用方式，但很多问题也随之而来：

- 为什么四大组件的另外两个**BroadcastReceiver**和**ContentProvider**不是**Context**的子类呢？
- 为什么**Application、Activity和Service**不直接继承**ContextImpl**呢，不是更直接吗？所谓的Decorator模式，也没看到有多大实际用处啊？

看一下ContentProvider的构造函数和**BroadcastReceiver.onReceive()**函数：

```java
// ContentProvider
public ContentProvider(
        Context context,
        String readPermission,
        String writePermission,
        PathPermission[] pathPermissions) {
    mContext = context;
    mReadPermission = readPermission;
    mWritePermission = writePermission;
    mPathPermissions = pathPermissions;
}

// BroadcastReceiver
public abstract void onReceive(Context context, Intent intent);
```

ContentProvider和BroadcastReceiver都需要把Context作为参数传入，虽然它们不继承于Context，但它们都依赖于Context，换个角度看：它们就是修饰器，包装了Context。因为这两个组件在使用上与Activity和Service存在较大的区别，所以它们的实现方式存在较大差异。

往深一步理解，Decorator模式的优势也体现出来了，譬如Application、Activity和Service都可以作为BroadcastReceiver的载体，只需要通过它们各自的Context去注册广播接收器就可以了，将BroadcastReceiver修饰在它们之上，就形成了新的功能扩展，而不是去扩展一个可以接收广播的Applicaiton、Activity或Service类。

> **题外话**，Decorator模式在Android中随处可见，除了Context类簇，还有Window类簇。

<font color="red"><b>
至此，我们已经领会了Context的设计思想，Context无处不在，它是应用进程与系统对话的一个接口:从使用的角度，更是可以将Context理解为应用进程的Android运行环境，想要什么资源，都可以向Context索取；从实现的角度，Context类簇利用Decorator设计模式，Android最核心的四大组件都可以理解为“修饰器”，它们从不同的功能维度扩展了Context的功能。
</b></font>

# 2. Context的源码分析

**Context**本身作为一个最高层的抽象类，仅仅是定义接口，方法的实现都在**ContextImpl**中。因为**Context**是为应用程序设计的，笔者试图通过两条主线来渗透**Context**的各项知识点：

- **第一条主线**：应用程序Application的Context构建过程
- **第二条主线**：应用界面Activity的Context构建过程

## 2.1 Application的Context的构建过程

在[应用进程与系统进程之间的通信](/2016-01-29-Activity-IPC)一文中，介绍过应用进程启动时，需要和系统进程进行通信:

- 当应用进程在初始化自己的主线程ActivityThread时，便会发起跨进程调用**IActivityManager.attachApplication()**，告诉系统进程(SystemServer)：我已经在Linux的世界诞生了，现在需要增加Android的属性(应用的包信息、四大组件信息、Android进程名等)，才能成为一个真正的Android进程。

- 系统进程在进行包解析时，就获取了所有应用程序的静态信息。在AMS中执行一个应用进程的**attachApplication()**时，便会将这些信息的数据结构准备好，发起跨进程调用**IApplicationThread.bindApplication()**，传送应用进程启动所必需的信息。

经过以上的交互，应用进程就进入**ActivityThread.handleBindApplication()**，开始构建自己所需的Android环境了：

<div align="center"><img src="/assets/images/context/3-context-application-context-sequence.png" /></div>


从时序图的第一个函数开始分析：

```java
// ActivityThread.handleBindApplication()
private void handleBindApplication(AppBindData data) {
    ...
    Application app = data.info.makeApplication(data.restrictedBackupMode, null);
    mInitialApplication = app;
    ...
    try {
        mInstrumentation.callApplicationOnCreate(app);
    } catch (Exception e) {...}
}
```

在**ActivityThread.handleBindApplication()**完成大量变量的初始化后，便开始创建一个Application类型的对象了，有了这个对象后便开始调用其**onCreate()**方法，就进入到了大家非常熟悉的一个系统回调函数**Application.onCreate()**。该函数片段的关键点是调用**LoadedApk.makeApplication()**创建Application对象，**data.info**是之前调用**ActivityThread.getPackageInfoNoCheck()**生成的LoadedApk对象，表示一个已经加载解析过的APK文件。

```java
// LoadedApk.makeApplication()
public Application makeApplication(boolean forceDefaultAppClass, Instrumentation instrumentation) {
    ...
    if (forceDefaultAppClass || (appClass == null)) {
        appClass = "android.app.Application";
    }
    try {
        java.lang.ClassLoader cl = getClassLoader();
        ContextImpl appContext = ContextImpl.createAppContext(mActivityThread, this);
        app = mActivityThread.mInstrumentation.newApplication(
                cl, appClass, appContext);
        appContext.setOuterContext(app);
    } catch (Exception e) {...}
    ...
}
```

该函数片段中，创建了一个**ClassLoader**对象和**ContextImpl**对象，连同将要构建的**Application**类名appClass，一起作为参数传送给**Instrumentation.newApplication()**方法，可想而知，最终的**Application**对象是反射构建的。

```java
// ContextImpl.createAppContext()
static ContextImpl createAppContext(ActivityThread mainThread, LoadedApk packageInfo) {
    if (packageInfo == null) throw new IllegalArgumentException("packageInfo");
    return new ContextImpl(null, mainThread,
            packageInfo, null, null, 0, null, null, Display.INVALID_DISPLAY);
}

// ContextImpl.constructor()
private ContextImpl(ContextImpl container, ActivityThread mainThread,
        LoadedApk packageInfo, IBinder activityToken, UserHandle user, int flags,
        Display display, Configuration overrideConfiguration, int createDisplayWithId) {
    mOuterContext = this; // 外围包装器，暂时用
    ...
    mMainThread = mainThread; // 主线程
    mActivityToken = activityToken; // 关联到系统进程的ActivityRecord
    mFlags = flags;
    ...
    mPackageInfo = packageInfo; // LoadedApk对象
    mResourcesManager = ResourcesManager.getInstance();
    ...
    Resources resources = packageInfo.getResources(mainThread);
    ...
    mResources = resources; // 通过各种计算得到的资源
    ...
    mContentResolver = new ApplicationContentResolver(this, mainThread, user); // 访问ContentProvider的接口
}
```

**ContextImpl**有三种不同的类型：

- **SystemContext**：系统进程SystemServer的Context
- **AppContext**：应用进程的Context
- **ActivityContext**：Activity的Context，只有ActivityContext跟界面显示相关，需要传入activityToken和有效的DisplayId

该函数片段是创建一个**AppContext**，要初始化的属性其实不多，需要特别注意的是：Context中会初始化一个**ContentResovler**对象，所以，可以通过Context操作数据库。Context创建完毕后，会作为参数传递给Instrumentation对象去构建一个Application对象：

```java
// Instrumentation.newApplication()
static public Application newApplication(Class<?> clazz, Context context)
        throws InstantiationException, IllegalAccessException, ClassNotFoundException {
    Application app = (Application)clazz.newInstance();
    app.attach(context);
    return app;
}

// Application.attach()
final void attach(Context context) {
    attachBaseContext(context);
    mLoadedApk = ContextImpl.getImpl(context).mPackageInfo;
}

// ContextWrapper.attachBaseContext()
protected void attachBaseContext(Context base) {
    if (mBase != null) {
        throw new IllegalStateException("Base context already set");
    }
    mBase = base;
}
```

Application对象是通过反射构建的，如果应用程序没有继承实现Application，则默认使用`android.app.Application`这个包名进行反射。构建Application对象完成后，便会调用其**attach()**函数绑定一个Context，这一绑定就相当于在**ContextWrapper**中关联了一个**ContextImpl**，这一层Decorator的修饰包装关系这就么套上了。

**回顾一下时序图，ActivityThread中发起Application对象的创建操作，然后创建一个真实的ContextImpl对象(AppContext)，最后将AppContext包装进Application对象中，才完成整个的修饰动作，在这之后，Application便可作为一个真正的Context使用，可以回调其生命周期的onCreate()方法了。**

## 2.2 Activity的Context构建过程

在[Activity的启动过程](2016-10-23-Activity-LaunchProcess-Part2)一文中，介绍过一个Activity是如何从无到有，再到显示状态的，这个过程极其复杂。本节将聚焦在Activity的Context构建时机，当要启动一个Activity时，**ActivityThread.performLaunchActivity()**会被调用，从这以后便会开始构建Activity对象，时序图如下：

<div align="center"><img src="/assets/images/context/4-context-activity-context-sequence.png" /></div>

```java
private Activity performLaunchActivity(ActivityClientRecord r, Intent customIntent) {
    ...
    try {
        java.lang.ClassLoader cl = r.packageInfo.getClassLoader();
        // 1. 反射构建Activity对象
        activity = mInstrumentation.newActivity(
                cl, component.getClassName(), r.intent);
        StrictMode.incrementExpectedActivityCount(activity.getClass());
        r.intent.setExtrasClassLoader(cl);
        r.intent.prepareToEnterProcess();
        if (r.state != null) {
            r.state.setClassLoader(cl);
        }
    } catch (Exception e) {...}

    try {
        // 2. 获取已有的Application对象
        Application app = r.packageInfo.makeApplication(false, mInstrumentation);
        if (activity != null) {
            // 3. 创建Activity的Context
            Context appContext = createBaseContextForActivity(r, activity);
            CharSequence title = r.activityInfo.loadLabel(appContext.getPackageManager());
            Configuration config = new Configuration(mCompatConfiguration);
            ...
            // 4. 将Context包装进Activity
            activity.attach(appContext, this, getInstrumentation(), r.token,
                    r.ident, app, r.intent, r.activityInfo, title, r.parent,
                    r.embeddedID, r.lastNonConfigurationInstances, config,
                    r.referrer, r.voiceInteractor, window);
            ...
            // 5. 调用Activity.onCreate()
            if (r.isPersistable()) {
                    mInstrumentation.callActivityOnCreate(activity, r.state, r.persistentState);
                } else {
                    mInstrumentation.callActivityOnCreate(activity, r.state);
            }
        }
    } catch (Exception e) {...}
    ...
}
```

该函数片段完成了从一个Activity对象构建到**Activity.onCreate()**函数被回调的过程：

1. 调用**Instrumentation.newActivity()**函数，传入这里通过ClassLoader和Activity的类名，反射构建一个Activity对象。

2. 获取已有的Application。**LoadedApk.makeApplication()**这个函数在前文分析过，当已有创建了一个Application时，会直接返回。

3. 调用**ActivityThread.createBaseContextForActivity()**函数，该函数内部会继续调用**ContextImpl.createActivityContext()**，创建一个ActivityContext。此处不再展开分析这两个函数，ContextImpl对象的初始化过程与上节中一致，请读者自行参考。

4. 以上过程都可以理解为在准备参数，真正将Context包装进Activity是调用**Activity.attach()**函数完成的，这个函数我们在分析Activity与Window的关系时，还会重点介绍。此处只需要理解其中一行，就是调用**ContextWrapper.attachBaseContext()**函数，将之前创建的ContextImpl对象包装到ContextWrapper中：

    ```java
    final void attach(Context context, ActivityThread aThread,
            Instrumentation instr, IBinder token, int ident,
            Application application, Intent intent, ActivityInfo info,
            CharSequence title, Activity parent, String id,
            NonConfigurationInstances lastNonConfigurationInstances,
            Configuration config, String referrer, IVoiceInteractor voiceInteractor,
            Window window) {
        attachBaseContext(context);
        ...
    }
    ```

5. Activity的Context构建完成后，便可以回调大家熟悉的**Activity.onCreate()**函数了。

<font color="red"><b>
可见，Activity和Application的Context构建过程极为相似，这也是符合逻辑的，因为它们本质上就是Context，只不过功能维度不同。其实Service的Context构建过程也很相似。无非都是构建ContextImpl对象，构建Decorator对象(Application、Activity和Service)，再将Decorator对象包装到ContextImpl对象之上。
</b></font>

# 3. Context的注意事项

## 3.1 不同类型Context的区别

从前文中可以看出，Android中有好几种不同的Context，在一个Activity中，就可以获取到以下几种Context：

- getApplication()
- getApplicationContext()
- getBaseContext()
- Activity.this

它们都什么区别呢？分别在什么时候使用呢？可以在Activity中通过以下代码，将这个Context分别打印出来：

```java
// 在Activity.onCreate()中插入以下代码：
Log.i(TAG, "Application: " + getApplication());
Log.i(TAG, "ApplicationContext: " + getApplicationContext());
Log.i(TAG, "Activity: " + this);
Log.i(TAG, "ActivityContext:" + this);
Log.i(TAG, "Application BaseContext: " + getApplication().getBaseContext());
Log.i(TAG, "Activity BaseContext: " + getBaseContext());

// 得到的运行结果：
I MainActivity: Application: com.duanqz.github.DemoApp@cf8644e
I MainActivity: ApplicationContext: com.duanqz.github.DemoApp@cf8644e
I MainActivity: Activity: com.duanqz.github.MainActivity@bbcadec
I MainActivity: Activity Context: com.duanqz.github.MainActivity@bbcadec
I MainActivity: Application BaseContext: android.app.ContextImpl@6a6a96f
I MainActivity: Activity BaseContext: android.app.ContextImpl@770267
```

可以看到，有以下几点不同：

- getApplication()和getApplicationContext()返回的是同一个对象`com.duanqz.github.DemoApp@cf8644e`，虽然同一块内存区域，但对象的类型不同：前者是Application，后者是Context。Java是强类型的语言，Application到Context相当于向上转型，会丢失掉一些接口的访问入口。

- 同理，Activity和Activity Context也是同一个对象，不同的类型。

- Application和Activity的Base Context都是ContextImpl对象，正是这个Context真正的实现类，被外围的修饰器包装了一下，才形成不同功能的类。

## 3.2 Context导致的内存泄露问题

Context经常会被作为参数传递，很容易导致内存泄露。以下代码片段是一个很常见的Activity泄露问题：

```java
public class MainActivity extends AppCompatActivity {
    protected void onCreate(Bundle savedInstanceState) {
       ... // Other codes
       Singleton.get(this);
    }
}

public class Singleton {
    private static Singleton sMe;
    private Singleton(Context context) {
        // Do something with context
    }

    public static synchronized Singleton get(Context context) {
        if (sMe == null) {
            sMe = new Singleton(context);
        }
        return sMe;
    }
}
```

本例中，有一个需要Context才能初始化的单例，在Activity中使用了这个单例，并且传入的Context是Activity对象。这种使用方式很可能导致Activity的泄露，因为MainActivity对象在应用进程的生命周期中可能会存在多个(譬如：多次进入/退出MainActivity界面、横竖屏切换都可能导致Activity对象的创建和销毁)，但单例却是存在于整个应用进程的生命周期的，Activity作为Context传送给单例，会导致Activity销毁后，其对象不能被垃圾回收，这样一来Activity对象就泄露了。

> 往深一点说：单例的实现都包含一个静态变量，而在Java的垃圾回收机制中，静态变量是GC ROOT，某对象只要存在到达GC ROOT的路径，就不会被回收。其实，所谓的内存泄露，都是生命周期短的对象没有被正确的回收，之所以没有被回收，是因为它们处在到GC ROOT的路径上，像静态变量、类加载器等都是GC ROOT，在使用过程如果关联到了生命周期短的对象，而且没有及时解除关联，就会产生内存泄露。

写过Android代码的朋友都知道，在单例中使用Context是一种刚需，那怎样才能解决内存泄露的问题呢？其实，只要传入一个生命周期长的Context就可以，自然就想到了与应用程序生命周期一致的ApplicationContext：

```java
public class MainActivity extends AppCompatActivity {
    protected void onCreate(Bundle savedInstanceState) {
       ... // Other codes
       Singleton.get(getApplicationContext());
    }
}
```

如此一来，就将单例与Application绑定，解决了Activity泄露的问题。这个案例提醒大家ApplicationContext和ActivityContext的使用场景是不同的：

- 使用ApplicationContext的场景：Context的生命周期超出Activity或Service的生命周期时，譬如工具类
- 使用ActivityContext的场景：Context的生命周期小于Activity，譬如初始化Activity的子控件、弹出对话框

# 4. 总结

本文从设计、源码和使用三个方面剖析了Android Context这一重要的概念，它是应用程序访问Android资源的接口，它是应用进程的运行环境，它是四大组件的基础，它是开发者既熟悉的陌生人。Context采用Decorator模式这一顶层设计，其对象构建/销毁都和四大组件紧密相关，稍有使用不当，便会导致内存泄露。

相信各位开发者在读完本文后，会对Context有一个更加深刻的认识。