---
layout: post
category : 工具使用
title: BeyondCompare使用介绍
tagline: BeyondCompare
tags : []
---
{% include JB/setup %}

# 概要

`BeyondCompare`是由[Scooter Software](http://www.scootersoftware.com/)推出的一款文件和目录对比工具，是一个共享软件，需要购买版权才能使用。
可以从官网[下载地址](http://www.scootersoftware.com/download.php)获取安装包。

在进行Android ROM适配的过程中，会频繁的用到BeyondCompare来对比文件差异，譬如：对比两个ROM包的差异，找出bin或lib文件是异同;对比smali文件，解决自动插桩的冲突;对比git库中，两个提交的差异等。

`BeyondCompare`提供Windows， Linux和Mac三类版本，本文以Linux的4.0版本为例，介绍BeyondCompare在ROM适配过程中一些使用技巧。

# 1. 忽略Smali文件对比时的行号差异

smali代码中通过 **.line** 关键字标识的行，会对应到Java代码的行号，譬如： “.line 147”，表示接下来的smali代码对应到Java代码的第147行。 **.line** 关键字并不影响smali语法的执行，在对比Smali文件时，可以忽略掉**.line** 关键字的差异，使得对比结果更加清晰。

- 在命令行输入如下命令，对比两个文件

{% highlight console %}
$ bcompare file1.smali file2.smali
{% endhighlight %}

该命令会启动BeyondCompare的图形界面，显示出file1.smali和file2.smali的文件差异，左侧的红色表示有差异的地方。红色越多，差异越大。

<div align="center"><img src="/assets/images/BeyondCompare/1-withlines.png"/></div>

- 在文件对比界面，点击工具栏的![image](/assets/images/BeyondCompare/2-rules-button.png)按钮，会弹出“会话设置对话框”：

<div align="center"><img src="/assets/images/BeyondCompare/3-SessionSettings-Importance.png"/></div>

- 选择**Edit Grammer**，弹出文本格式设置界面：

<div align="center"><img src="/assets/images/BeyondCompare/4-TextFormat.png"/></div>

- 点击 **"+"** 按钮，新增一条规则如下：

<div align="center"><img src="/assets/images/BeyondCompare/5-IgnoreLines-Grammer.png"/></div>

- 这时会重新回到“会话设置对话框”界面，看到新增的规则 **IgnoreLines**：

<div align="center"><img src="/assets/images/BeyondCompare/6-SessionSettings.png"/></div>

- 回到文本对比界面，点击工具栏![image](/assets/images/BeyondCompare/7-minor-button.png)，忽略不重要的差异。这时候，对比的结果发生的变化，所有**.line**行的差异都被忽略了，明显可见左侧的红色少了很多。

<div align="center"><img src="/assets/images/BeyondCompare/8-withoutlines.png"/></div>


# 2. 文件夹比较时快速查找文件

在命令行输入如下命令，对比两个目录

{% highlight console %}
$ bcompare fold1 fold2
{% endhighlight %}

该命令会启动BeyondCompare的图形界面，显示出fold1和fold2两个目录下所有文件的差异。当需要定位到某一个文件查看时，可以利用过滤器![image](/assets/images/BeyondCompare/9-filters.png)，
过滤器的内容是一个正则表达式，只需要输入要查找的文件名关键字，然后查询即可。

# 3. 将BeyondCompare作为git的图形化对比工具

准确说这应该是git的使用技巧,但涉及BeyondCompare这个工具,这里一并做下介绍。

- 在 Linux 下,执行以下命令配置git的默认可视化比较工具

{% highlight console %}
$ git config --global diff.tool bc3
$ git config --global difftool.prompt false
{% endhighlight %}

- 使用BeyondCompare比较两个commit的差异, git difftool命令其他使用与git diff一致。

{% highlight console %}
$ git difftool commit_old [commit_new] [file] &
{% endhighlight %}
