---
layout: post
category : 编程思想
title: React Native开发环境
tagline:
tags : 编程
---

# 1. 概览

# 2. 背景

`React Native`是Facebook的一个开源项目<https://github.com/facebook/react-native>，能够让开发者利用JavaScript和React来编写Native程序。
这里所说的Native是指iOS和Android平台，譬如：基于Android SDK，用Java编写一个APK，这个APK就是一个Native程序。

`React Native`带来了不同：基于React这个开源库、用JavaScript来编程; 但最终产生的仍是一个Native程序。这就带来了一些问题：

> 1. 什么是React，为什么是用JavaScript语言来编程？
> 2. 为什么最终产出仍是一个Native程序？
> 3. React Native的设计思想是什么？

## 2.1 什么是React

`React`先于`React Native`诞生，React也是Facebook的一个开源项目<https://github.com/facebook/react>，专供用户交互的一个JavaScript库。


## 2.2 Native方式开发的优劣

**Native方式的优势**

- **体验更好**。由于大量的Native控件可以被使用，而且Native控件与整个系统结合的非常好，所以Native方式的应用能呈现出更好的体验。
  虽然Web方式可以重写这些控件，但体验上仍不及Native是一个不争的事实，譬如，在手势识别上，Web方式就不如Native方式那么精确。

- **性能更优**。Native方式都具备优秀的多线程模型，能够充分的利用CPU资源，在一些特殊领域上也有硬件支持，譬如图像、视频解码。
  然而，Web方式在高性能和高响应上，仍存在难以逾越的障碍。

**Native方式的劣势**

- **编译耗时**。任何修改都需要重新编译来验证，哪怕是简单修改一个字符串，都需要重新将整个模块编译一次。
  对于大型的应用而言，编译一次的时间会很长。开发人员往往会因为一处修改，耗费大量时间在等待编译。

- **验证不便**。Native方式的应用不太可能频繁发布，因为频繁安装最新版本会影响用户体验，所以发布频率一般以周或者月为单位;
  然而，Web方式的应用却可以频繁发布，因为在用户体验上完全是无缝升级的，所以发布频率甚至能以天为单位。
  发布节奏越慢，要验证一个功能的周期就越长。

Native方式的优劣，就对应着Web方式的劣优。市面上大型的应用，都还是以Native方式实现，就是考虑到体验和性能，而牺牲一些开发的成本。

## 2.3 React Native的设计思想

# 3. 实战

## 3.1 React Native开发环境

笔者的工作环境是Ubuntu 14.04 LTS版本。

- **Android SDK**: 

- **NoteJS**：<https://nodejs.org/en/download/>

- **Watchman**: 由Facebook开发的

- **Flow**: 一个JS的静态类型检查工具

{% highlight console %}
$ sudo npm install -g flow-bin
{% endhighlight %}

---

**参考文献**

1. <https://code.facebook.com/posts/1014532261909640/react-native-bringing-modern-web-techniques-to-mobile/>
2. 