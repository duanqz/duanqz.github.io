---
layout: post
category : 技术札记
title: Java ThreadLocal的演化、实现和场景
tagline:
tags : [Java编程]
---

`ThreadLocal`，在没有任何背景知识的情况下，我们从英文单词的意思上理解它：

- **Thread**：跟线程相关。Java语言中，表示线程的类就是Thread，是程序最小的执行单元，多个线程可以**并发**执行。
- **Local**：本地、局部，与之相对的概念就是远程、全局。Java语言中，通常用Local表示局部变量。

这两个概念一组合，拼成了英文单词**ThreadLocal**，线程局部？局部线程？究竟要表达什么意思，为什么不叫**LocalThread**，完全找不着北啊！

笔者搜罗了网上对**ThreadLocal**的一些解读：

- **ThreadLocal**为解决多线程程序的并发问题提供了一种新的思路。使用这个工具类可以很简洁地编写出优美的多线程程序，**ThreadLocal**并不是一个Thread，而是Thread的局部变量，把它命名为ThreadLocalVariable更容易让人理解一些

- **ThreadLocal**并不是用来并发控制访问一个共同对象，而是为了给每个线程分配一个只属于该线程的变量。它的功用非常简单，就是为每一个使用该变量的线程都提供一个变量值的副本，是每一个线程都可以独立地改变自己的副本，而不会和其它线程的副本冲突，实现线程间的数据隔离。从线程的角度看，就好像每一个线程都完全拥有该变量

- **ThreadLocal**类用来提供线程内部的局部变量。这种变量在多线程环境下访问(通过get或set方法访问)时能保证各个线程里的变量相对独立于其他线程内的变量。**ThreadLocal**实例通常来说都是private static类型的，用于关联线程和线程的上下文

- 引入**ThreadLocal**的初衷是为了提供线程内的局部变量，而不是为了解决共享对象的多线程访问问题。实际上，ThreadLocal根本就不能解决共享对象的多线程访问问题

这些解释都没错，但并不是很好理解，而且大多数读者也没有真正使用过**ThreadLocal**，字面意思看上去理解了，真正到用的时候又不知从何下手。
笔者试图由简入繁，通过生活中的例子，来描述**ThreadLocal**的演化、实现和使用场景。

# 1. 演化过程

以实际生活中的银行业务办理模型，解释ThreadLocal的诞生过程。读者们可以看到：随着业务模型的不断扩展，代码逻辑变得更加复杂，经过不断优化代码结构的过程，演化出了**ThreadLocal**这个编程工具。

## 1.1 初始形态

> 大家去银行办理业务时，如果需要排队等候，则会领取一个排队号，直到叫号才能办理业务。
>
> 我们把每一笔业务(Transaction)抽象为一个线程，每一笔业务都有一个唯一的标识(id)。

```java
class Transaction extends Thread {
    private int id;

    public void run() {
        if (wait) {
            ... // Waiting
        } else {
            ... // Start transaction
        }
    }
}
```

在这个模型里面，每新来一笔业务，都需要运行一个线程，然后分配一个全局唯一的业务标识(id)给这个新的线程，简化以后的代码逻辑如下：

```java
int id = nextTransactionId();
new Transaction(id).start();
```

## 1.2 扩展形态

> 现在，需要把业务模型扩展一下，每一笔业务还需要知道等待时间(waitTime)，等待人数(waitPeople)等。
>
> 于是乎，在原有的线程里面，又增加了一些局部变量和控制逻辑，线程运行以后便会对这些局部变量进行读写操作。

```java
class Transaction extends Thread {
    private int id;
    private long waitTime;
    private long waitPeople;
    private int serviceWindow;
    ... // Other extension

    public void run() {
        if (wait) {
            waitTime increasing
            ... // Waiting
        } else {
            serviceWindow assigned
            ... // Start transaction
            waitPeople decreasing
        }
    }
}
```

添加完扩展的代码逻辑之后，我们发现这种编程方法并不好：譬如，要扩展一个业务办理时长(serviceTime)，又得新增一个局部变量。可以想象，类似的扩展还有很多。于是乎，我们想到把这些零散的字段封装成一个类，这里我们命名为Session，表示一个事务所需要操作的数据集合:

```java
class Transaction extends Thread {
    private Session session;

    public void run() {
        if (wait) {
            ... // Waiting
            Read/Write session
        } else {
            ... // Start transaction
            Read/Write session
        }
    }
}

class Session {
    private int id;
    private long waitTime;
    private long waitPeople;
    private int serviceWindow;
    ... // Other extension
}
```

这样一来，每个线程都拥有一个局部变量Session，后续可以在Session的基础上进行扩展，降低Transaction的复杂度，当线程运行时，需要对Session对象进行读写。

**注意，银行的业务是多窗口同时办理的，意味着这些线程可以并发执行。以上代码并没有锁控制，因为每个线程都是修改自己的局部变量，并不影响其他线程。**

> 随着银行的业务变得愈加复杂，譬如：客户可以买卖理财产品，缴纳日常生活费用。
>
> Transaction的代码量变得越来越大，于是乎，又把与理财业务相关的代码封装到FinancialService。

```java
class Transaction extends Thread {
    private Session session;

    public void run() {
        if (wait) {
            ... // Waiting
            Read/Write session
        } else {
            ... // Start transaction
            Read/Write session
        }
    }
}

class Session {
    private int id;
    private long waitTime;
    private long waitPeople;
    private int serviceWindow;
    private long serviceTime;
    ... // Other extension
}

class FinancialService {
    Session session;

    public void setSession(Session session) {
        this.session = session;
    }

    public void doService() {
        Read/Write session
        ... // Do financial service
    }
}
```

扩展出来的FinancialService需要读写Session中的数据，譬如：获取分配的服务窗口(serviceWindow)、更新服务时间(serviceTime)，所以，在FinancialService类中也会有一个局部变量Session，它是外部传入进来的。

可以这么来理解：FinancialService属于一个具体的事务，FinancialService对象仍然属于Transaction这个线程的生命周期，在Transaction线程的生命周期内，需要将Session对象传入FinancialService对象。

## 1.3 改良形态

> Transaction线程的代码逻辑已经很复杂了，涉及到很多类的封装和数据传递，在线程运行时，有一些变量是在整个线程的生命都存在的，如果线程中某些对象需要使用这些变量，就需要封装一些接口进行数据传递。有没有一种便捷的方式来访问这些变量呢？
>
> 在Transaction中创建一个Map类型的局部变量，通过一个全局可以访问的Key，便可对Session进行存取操作。在线程生命周期的任何地方，只需要通过Key，就可以获取到Session

```java
// 全局可以访问的Key
static SessionKey globalKey = new SessionKey();

class Transaction extends Thread {
    Map<SessionKey, Session> map;

    public void run() {
        // 将Session保存到线程的局部变量map中
        map.put(globalKey, session);
        if (wait) {
            ... // Waiting
            Read/Write session
        } else {
            ... // Start transaction
            Read/Write session
        }
    }
}

class FinancialService {
    public void doService() {
        // 获取当前运行的线程
        Thread t = Thread.currentThread();
        // 通过全局的globalKey从线程的Map中取出Session
        Session session = t.map.get(globalSessionKey);
        ... // Do financial service
    }
}

```

**注意：此处有两个关键点：**

1. **全局变量Key**，所有线程都可以访问
2. **局部变量Map**，属于每个线程，这个Map中每一项的Key是全局的，而Value是局部的

把上述两者之间的关系图示出来：

<div align="center"><img src="/assets/images/threadlocal/1-threadlocal-transaction.png" /></div>

线程类**Transaction**中定义了一个类型为**Map**的变量，其中每一项的*Key*为**SessionKey**，*Value*为**Session**。

**读者一定心生疑问了，直接将Session作为全局变量不就可以了吗？为什么还要搞一个线程的局部变量Map？**

这就涉及到多线程数据访问了：对于Session而言，每个线程都各自维护自己的，修改了也不需要告诉其他线程。如果将Session直接作为全局变量，那每个线程都改的是同一份数据，还需要进行多线程的锁控制。


演化到这一步，ThreadLocal就呼之欲出了。

# 2. 实现原理

先直接把**Thread**与**ThreadLocal**之间关系图示出来：

<div align="center"><img src="/assets/images/threadlocal/2-threadlocal-structure.png" /></div>

这个结构图跟上面改良形态的Transaction结构图简直如出一辙，只不过**ThreadLocal**做了更多的封装：

- 线程类**Thread**中有一个类型为**ThreadLocalMap**的变量为*threadLocals*
- **ThreadLocalMap**是一个映射表，内部实现是一个数组，每一个元素的类型为**Entry**
- **Entry**就是一个键值对(*Key-Value Pair*)，其 *Key* 就是**ThreadLocal**，其 *Value* 可以是任何对象

接下来，我们深入到源码，窥探一下**ThreadLocal**的奥妙。

## 2.1 ThreadLocal的主要接口

**ThreadLocal**对外提供的接口并不多：JDK 1.8以前，仅**set()**、**get()**和**remove()**三个接口；JDK 1.8以来，多提供了一个**withInitial()**接口。这些接口其实就是针对线程中**ThreadLocalMap**的增删改查操作。

- **set()**，表示要往当前线程中设置“本地变量”，最终的结果是将变量设置到了线程的映射表。

    ```java
    // ThreadLocal.set()
    public void set(T value) {
        // 获取当前线程
        Thread t = Thread.currentThread();
        // 获取线程中的映射表
        ThreadLocalMap map = getMap(t);
        if (map != null)
            // 设置映射表的Key-Value，Key就是当前ThreadLocal对象
            map.set(this, value);
        else
            createMap(t, value);
    }

    ThreadLocalMap getMap(Thread t) {
        return t.threadLocals;
    }
    ```

- **get()**，表示要从当前线程中取出“本地变量”，最终的结果是在当前线程的映射表中，以调用get()方法的**ThreadLocal**对象为*Key*，查询出对应的*Value*。

    ```java
    // ThreadLocal.get()
    public T get() {
        Thread t = Thread.currentThread();
        ThreadLocalMap map = getMap(t);
        if (map != null) {
            // 获取映射表中当前ThreadLocal对应的Value
            ThreadLocalMap.Entry e = map.getEntry(this);
            if (e != null) {
                @SuppressWarnings("unchecked")
                T result = (T)e.value;
                return result;
            }
        }
        // 如果Map还未初始化或者Map中没有找到Key，则设置一个初始值
        return setInitialValue();
    }

    private T setInitialValue() {
        // 获取初始值，这个方法通常由ThreadLocal的泛型实例化类去实现
        T value = initialValue();
        Thread t = Thread.currentThread();
        ThreadLocalMap map = getMap(t);
        if (map != null)
            map.set(this, value);
        else
            createMap(t, value);
        return value;
    }
    ```

**ThreadLocal**的set()和get()方法的主体逻辑算是比较简单了，围绕主体逻辑，还做了一些特殊处理，譬如：线程中的映射表还未初始化时，调用createMap()进行初始化；在映射表中没有获取到*Value*时，通过setInitialValue()设置一个初始值，这种场景下，只需要实现initialValue()函数就可以了，这种**ThreadLocal**的使用方式很常见。本文不再展开这些细枝末节的逻辑，读者自行阅读源码即可。

## 2.2 ThreadLocalMap映射表

**ThreadLocal**并不是一个存储容器，往ThreadLocal中读(get)和写(set)数据，其实都是将数据保存到了每个线程自己的存储空间。

线程中的存储空间是一个映射表(ThreadLocalMap)，**TheadLocal**其实就是这个映射表每一项的*Key*，通过**ThreadLocal**读写数据，其实就是通过*Key*在一个映射表中读写数据。

上文中图示中，我们见过映射表的结构，它是一个名为table的数组，每一个元素都是Entry对象，而Entry对象包含key和value两个属性，其代码如下所示：

```java
static class Entry extends WeakReference<ThreadLocal<?>> {
    /** The value associated with this ThreadLocal. */
    Object value;

    Entry(ThreadLocal<?> k, Object v) {
            super(k);
            value = v;
        }
    }
}
```

**ThreadLocalMap**的Entry是WeakReference的子类，这样能保证线程中的映射表的每一个Entry可以被垃圾回收，而不至于发生内存泄露。因为**ThreadLocal**作为全局的*Key*，其生命周期很可能比一个线程要长，如果Entry是一个强引用，那么线程对象就一直持有**ThreadLocal**的引用，而不能被释放。随着线程越来越多，这些不能被释放的内存也就越来越多。

**ThreadLocal**作为映射表的*Key*，需要具备唯一的标识，每创建一个新的**ThreadLocal**，这个标识就变的跟之前不一样了。
如何保证每一个**ThreadLocal**的唯一性呢？

```java
public class ThreadLocal<T> {
    private static final int HASH_INCREMENT = 0x61c88647;
    // 每一个ThreadLocal对象的HashCode都不一样
    private final int threadLocalHashCode = nextHashCode();
    private static int nextHashCode() {
        // 下一个HashCode，是在已有基础上增加0x61c88647
        return nextHashCode.getAndAdd(HASH_INCREMENT);
    }
}
```

**ThreadLocal**内部有一个名为threadLocalHashCode的变量，每创建一个新的**ThreadLocal**对象，这个变量的值就会增加`0x61c88647`。
正是因为有这么一个神奇的数字，它能够保证生成的Hash值可以均匀的分布在0~(2^N-1)之间，N是数组长度。
更多关于数字`0x61c88647`，可以参考[Why 0x61c88647?](https://www.javaspecialists.eu/archive/Issue164.html)


# 3. 使用场景

在介绍具体的使用场景之前，我们先来抽象一下：

<div align="center"><img src="/assets/images/threadlocal/3-threadlocal-usage.png" /></div>

这个图表示：多个线程的生命周期不同，当一个线程在其生命周期内的某个时候，调用ThreadLocal.set()方法，其实就在该线程内部启用了一个局部变量，而后这个局部变量可以在该线程生命周期的任何时候被获取，直到调用ThreadLocal.remove()方法或者线程消亡。

<font color='red'>线程通过<b>ThreadLocal</b>提供的接口来操作自己内部的映射表，或者可以在语意上这么理解：线程把<b>ThreadLocal</b>当做自己的局部变量，不过对这个变量的赋值操作是set()，读取操作是get()，清空操作是remove()。</font>

## 3.1 Android Looper

Android中有一个很常见的操作：使用Handler将消息抛送到线程的消息队列。控制消息队列的类是**Looper**，每个拥有消息队列的线程，都会有一个独立的**Looper**类，用于处理本线程的消息。
一种实现方式是：在线程类中，声明一个**Looper**类型的局部变量，当线程运行起来时，创建**Looper**对象，并开始进行无限循环，代码示意如下：

```java
public class LooperThread extends Thread {
    private Looper mLooper;

    @Override
    public void run() {
        // 创建Looper对象(实际上，Looper类的构造器是私有的)
        mLooper = new Looper();
        // 开始无限循环处理消息
        mLooper.loop();
    }

    public Looper getLooper() {
        return mLooper;
    }
}
```

**注意到**，这种实现方式需要增加一个方法：**getLooper()**，因为其他线程可能需要获取**LooperThread**的消息队列。
然而，Android并不是采用的上述实现方式，而是利用**ThreadLocal**来保存**Looper**对象，当一个线程想要拥有消息队列时，调用**Looper.prepare()**方法便可完成消息队列的初始化，然后调用**Looper.loop()**便会开始无限循环，不断从消息队列上取出消息进行处理。先来看**Looper**的代码实现片段：

```java
public final class Looper {
    static final ThreadLocal<Looper> sThreadLocal = new ThreadLocal<Looper>();
    // 私有构造器，意味着外部不能调用
    private Looper(boolean quitAllowed) {
        mQueue = new MessageQueue(quitAllowed);
        mThread = Thread.currentThread();
    }

    public static void prepare() {
        prepare(true);
    }

    private static void prepare(boolean quitAllowed) {
        if (sThreadLocal.get() != null) {
            throw new RuntimeException("Only one Looper may be created per thread");
        }
        // 通过ThreadLocal保存新建的Looper对象
        sThreadLocal.set(new Looper(quitAllowed));
    }

    public static Looper myLooper() {
        // 返回实际线程的Looper对象
        return sThreadLocal.get();
    }
}
```

**Looper**中定义了一个静态变量*`sThreadLocal`*，构造器都是私有的(private)，即外部无法调用，然后提供了一个**prepare()**方法，当该方法被调用时，便往*`sThreadLocal`*中设置一个**Looper**对象。

上文剖析过**ThreadLocal**的实现，可以知道：哪个线程调用了**prepare()**方法，**Looper**对象就添加到了那个具体线程的**ThreadLocalMap**映射表中，表中每一项的*Key*是*`sLocalThread`*，*Value*是**Looper**对象，这样一来，就等价于线程拥有了**Looper**这个局部变量。如何获取线程中的**Looper**对象呢？在线程中直接调用**ThreadLocal.get()**方法就可以了，所以**Looper**类封装了一个静态方法**myLooper()**，做的就是获取当前线程**Looper**对象的买卖。

Android中，真正带消息队列的线程实现是**HandlerThread**，与上文中模拟的**LooperThread**的实现方式如出一辙，不过是利用了**ThreadLocal**这个编程工具：

```java
public class HandlerThread extends Thread {
    public void run() {
        mTid = Process.myTid();
        Looper.prepare();  // 初始化消息队列，即将Looper对象添加到实际线程的ThreadLocalMap中
        synchronized (this) {
            mLooper = Looper.myLooper(); // 获取实际线程的Looper对象
            notifyAll();
        }
        Process.setThreadPriority(mPriority);
        onLooperPrepared();
        Looper.loop();  // 开始无限循环处理消息
        mTid = -1;
    }

    public Looper getLooper() {
        if (!isAlive()) {
            return null;
        }
        
        // If the thread has been started, wait until the looper has been created.
        synchronized (this) {
            while (isAlive() && mLooper == null) {
                try {
                    wait();
                } catch (InterruptedException e) {
                }
            }
        }
        return mLooper;
    }
}
```

当线程运行起来时，往**ThreadLocal**中添加了一个**Looper**对象，然后开始无限循环处理消息。往**ThreadLocal**中添加对象的行为，就意味着这个对象是属于每个线程的局部变量。

当有多个HandlerThread同时运行时，它们的关系如下图所示：

<div align="center"><img src="/assets/images/threadlocal/4-threadlocal-handlerthread.png" /></div>

每一个HandlerThread线程内部都有**Key-Value Pairs**，*Value*是不同的Looper对象，而*Key*是指向同一个静态ThreadLocal对象的弱引用。

## 3.2 Android SQLiteDatabase

Android中进行数据库的事务操作时，通常都会在某个工作线程中调用SQLiteDatabase.beginTransaction()方法，然后开始具体的数据库操作。有些时候，并发操作数据库的线程会存在多个，要操作数据库，是要发起连接的，Android封装了一个类**SQLiteSession**，专门来管理数据库连接，每个线程都需要**SQLiteSession**对象，那线程怎样才能获取到一个独立的**SQLiteSession**对象呢？这种场景下，便有了ThreadLocal的用武之地了。

```java
public final class SQLiteDatabase extends SQLiteClosable {
    // 定义ThreadLocal，存储的对象类型是SQLiteSession
    private final ThreadLocal<SQLiteSession> mThreadSession = new ThreadLocal<SQLiteSession>() {
        @Override
        protected SQLiteSession initialValue() {
            return createSession();
        }
    };

    SQLiteSession getThreadSession() {
        // 通过ThreadLocal获取SQLiteSession对象
        return mThreadSession.get(); // initialValue() throws if database closed
    }

    private void beginTransaction(SQLiteTransactionListener transactionListener,
            boolean exclusive) {
        acquireReference();
        try {
            // 获取SQLiteSession对象后，开始数据库的事务操作
            getThreadSession().beginTransaction(
                    exclusive ? SQLiteSession.TRANSACTION_MODE_EXCLUSIVE :
                            SQLiteSession.TRANSACTION_MODE_IMMEDIATE,
                    transactionListener,
                    getThreadDefaultConnectionFlags(false /*readOnly*/), null);
        } finally {
            releaseReference();
        }
    }

}
```

SQLiteDatabase中定义了**ThreadLocal**，所存储对象的类型是SQLiteSession。每当在线程中调用**SQLiteDatabase.beginTransaction()**方法时，表示要开始数据库的事务操作了，这时候会先从**ThreadLocal**中取出属于当前线程的SQLiteSession对象。

在多进程多线程访问数据库的情况下，它们的关系图如下所示：

<div align="center"><img src="/assets/images/threadlocal/5-threadlocal-sqlitedatabase.png" /></div>


## 3.4 总结

通过上述使用场景可以发现，**ThreadLocal**确实提供了一种编程手段，本来需要在线程中显示声明的局部变量，像是被**ThreadLocal**隐藏了起来，当多个线程运行起来时，每个线程都往相同的**ThreadLocal**中存取所需要的变量就可以了，使用**ThreadLocal**存取的变量，就像是每个线程自己的局部变量，不受其他线程运行状态的影响。

通过**ThreadLocal**可以解决`多线程读`共享数据的问题，因为共享数据会被复制到每个线程，不需要加锁便可同步访问。但**ThreadLocal**解决不了`多线程写`共享数据的问题，因为每个线程写的都是自己本线程的局部变量，并没将写数据的结果同步到其他线程。理解了这一点，才能理解所谓的：

- **ThreadLocal**以空间换时间，提升多线程并发的效率。什么意思呢？每个线程都有一个**ThreadLocalMap**映射表，正是利用了这个映射表所占用的空间，使得多个线程都可以访问自己的这片空间，不用担心考虑线程同步问题，效率自然会高。
- **ThreadLocal**并不是为了解决共享数据的**互斥写**问题，而是通过一种编程手段，正好提供了**并行读**的功能。什么意思呢？**ThreadLocal**并不是万能的，它的设计初衷只是提供一个便利性，使得线程可以更为方便地使用局部变量。
- **ThreadLocal**提供了一种线程全域访问功能，什么意思呢？一旦将一个对象添加到**ThreadLocal**中，只要不移除它，那么，在线程的生命周期内的任何地方，都可以通过**ThreadLocal.get()**方法拿到这个对象。有时候，代码逻辑比较复杂，一个线程的代码可能分散在很多地方，利用**ThreadLocal**这种便利性，就能简化编程逻辑。