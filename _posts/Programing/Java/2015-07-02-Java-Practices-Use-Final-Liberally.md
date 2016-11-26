---
layout: post
category : 编程
title: Java的final关键字
tagline:
tags : java final
---

final是Java语言中的修饰符，可以修饰类、方法、属性、函数入参、局部变量，意图表达被修饰对象的最终状态，即不可再被修改。

# final关键字的使用场景

使用**final**关键字一般有以下显示的作用：

- **final修饰类** 无法被继承
- **final修饰类方法** 无法被重写(Override)
- **final修饰的类属性、函数参数、局部变量** 只能被赋值一次

对于final关键字，还有一些隐式的作用：

- **final修饰对象** 对象的引用只能被赋值一次，但对象本身是可以被修改的
- **final修饰基本类型** 与生俱来就是线程安全的，因为变量只会被写一次

此外，**final**关键字可以清晰了表达了代码设计者的意图，也能增强代码的可读性：

- **final修饰函数入参**
函数不会对入参进行修改，调用者可以放心的使用该函数，而不用担心调用后传入的参数被篡改。

- **final修饰局部变量**
在一个函数中，更为被关注的是一些与逻辑相关的局部变量(返回值，循环体计数器)，如果某些局部变量的存在就是为了一次数据的存储，那么，就可以用**final**修饰这些局部变量。
这样，读代码的时候，就能聚焦到没有通过**final**修饰的局部变量，更快的理解代码逻辑。

以下是一个**final**修饰符的使用实例：

```java
import java.util.*;
import java.lang.reflect.Field;

/** 该类不能被继承. */
public final class Boat {

    public Boat(final String aName, final int aLength, final Date aDateManufactured){
        fName = aName;
        fLength = aLength;

        fDateManufactured = new Date(aDateManufactured.getTime());

        // 以下两行代码会导致编译报错，因为对final修饰函数入参做了赋值操作
        //aDateManufactured = null;
        //aLength = 0;
    }

    public Integer bestRaceScore(){
        // 返回值result，没有使用final修饰，因为返回值需要为调用者所用
        Integer result = Integer.valueOf(0); 
        // 使用final修饰返回值，会导致编译报错
        //final Integer result = Integer.valueOf(0);

        // final修饰局部变量scores
        final List<Integer> scores = fRaceScores;
        for(Integer score : scores){
          if (score > result){
            result = score;
          }
        }
        return result;
    }

    // PRIVATE
    private final String fName;
    private final int fLength;
    private List<Integer> fRaceScores = new ArrayList<>();
    private final Date fDateManufactured;
}
```

**在早期的Java实现版本中，使用final方法的原因有两个。第一个原因是把锁定，以防任何继承类修改它的含义；第二个原因是效率，编译器会将final方法转为内嵌调用，节省函数调用的时间。
但是函数调用时间一般不会成为性能瓶颈，当函数体过大时，内嵌调用带来的任何性能提升也是微乎其微的，所以，新的Java实现版本中，已经没有这项优化了。**
<font color='red'>final关键字更重要的还是反映代码设计者的意图。</font>

***

# final关键字的使用细节

<br/>
<font size="4"><b>final局部变量与普通局部变量有什么区别</b></font>

final修饰局部变量，相当于给编译器一个信号，与普通局部变量不同的是：

- final局部变量只能被赋值一次，而普通局部变量不受限
- 编译优化。如果编译器能够确定final局部变量的值，那么就会把final局部变量当作常量使用

具体可以看如下代码：

```java
final String final_str = "ABC";
String common_str = "ABC";
System.out.println(final_str == common_str); // 打印值为true

String combined_final_str = final_str + "D";
String combined_common_str = common_str + "D";
System.out.println(combined_final_str == combined_common_str); //打印值为false
```

由于**final_str**在编译时就已经确定下来了，所以，在**combined_final_str**中，编译器直接将**final_str**替换成了字符串，存储到常量池中，所以**combined_final_str**的地址是指向常量池的。
而**combined_common_str**变量的地址是需要运行时链接生成的，地址显然与**combined_final_str**变量的地址是不一样的。

<br/>

<font size="4"><b>内部类只能引用外围类的final局部变量</b></font>

在Java内部类可以访问外围类的局部变量，这是内部类的一项特性，如下代码所示：

```java
public void test(final String outParam) {   // 必须通过final修饰形参
    final String outLocal = "ABC";          // 必须通过final修饰局部变量
    new Thread(){
        public void run() {
            System.out.println(outParam);   // 内部类中直接访问外围类方法的参数
            System.out.println(outLocal);   // 内部类中直接访问外围类的局部变量
        };
    }.start();
}
```

局部变量是有生命周期的，**outParam和outLocal**的生命周期，伴随这test()方法结束而结束，但此时内部类的生命周期可能还未结束，要做到访问外围的生命周期有限的变量，Java想出了一套办法：**就是将这些变量拷贝到内部类的作用域中。**

实际上，内部类中访问的变量与外围类的局部变量不是同一个变量，这样就解决了局部变量生命周期有限的问题，但如果不用**final**来修饰局部变量，就会引发数据不一致的问题，因为内部类如果可以对变量值进行修改，会同一个变量的两份拷贝数据不一致。从这个层面上，我们也能理解为什么**final**与生俱来的线程安全性。
