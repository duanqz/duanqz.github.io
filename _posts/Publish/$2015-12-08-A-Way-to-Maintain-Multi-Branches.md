---
layout: post
category: Publish
title: 一种Android多分支的自动合并方案
tagline:
tag: [多分支管理]
---
{% include JB/setup %}

# 1. 背景

对于Android系统级开发人员而言，维护多个分支的代码是常态，尤其是当新的Android版本发布时，设备厂商更是苦不堪言，即疲于最新Android版本的适配，又苦于大量旧机型的维护。
为了尽可能的减少维护的工作量，设备厂商有很多手段来避免新增分支，譬如：

- **编译时过滤**。通过编译开关来兼容代码差异，以便于一个分支下，通过不同的开关配置，编译出不同的版本。静态编译开关以**MTK的方案**为代表，HTC、SONY等大厂商都有采用这种方式。

- **运行时反射**。多份功能类似的代码都经过编译，但运行时，根据配置信息，选择加载的类。运行时反射以**CM的方案**为代表，尤其是RIL层的反射框架极为精彩。

- **基于SDK开发**。很多应用层的开发都转向了基于SDK或基于厂商自己的中间件。即便框架层有差异，需要新增分支，但应用层仍然可以做到不开设新分支。

以上手段能够减少分支的膨胀，但并不能完全避免新增分支。设备厂商通常都不是完全基于AOSP进行开发，而是基于不同芯片的平台方案，然而不同的芯片厂商都会提供自己的平台方案，譬如MTK， QCOM， SAMSUNG等，
芯片平台方案的差异，导致设备厂商不得不额外新增分支，如此一来，多分支管理的噩梦依旧挥之不去。

其实，与大部分设备厂商一样，Google也面临着**AOSP(Android Open Source Project)**多分支的管理问题，在Kitkat发布之前，Lollipop就已经启动开发了[1]，
同时，Android还引入了很多开源项目和第三方社区贡献的代码，这些都需要开设分支。

本文提出了一种多分支的自动合并方案，将一个分支的代码提交自动合并到其他分支，能够有效地缓解多分支维护的压力。

# 2. 方案

同时维护多个分支，意味着在一个分支上的代码变更，也可能适应于其他分支，这种情况下，开发人员可以在其他分支上提交相同的代码变更。
然而，随着分支数量的膨胀，重复提交不仅繁琐而且容易遗漏。因此，有必要引入**自动提交**的机制：当一个分支上有变更时，自动将这个变更记录提交到其他分支。
这样，代码变更就像是从一个分支上**流**向了其他分支，**流**的起点称为**上游分支(upstream)**，**流**的终点称为**下游分支(downstream)**，代码的自动提交机制称为**代码流**。

## 2.1 代码合并方式比较

Android采用git进行代码版本管理，将一个分支的代码合并到另一个分支，git有三种方式：`rebase`、`cherry-pick`和`merge`。
这三种方式的原理并不相同，出于分支不断演进变化的考虑，代码流采用`merge`的方式，

### cherry-pick

**在downstream上，使用cherry-pick从upstream选择所需要的提交**

{% highlight console %}
$ git cherry-pick E,F
{% endhighlight %}

<div align="center"><img src="/assets/images/aospcodeline/4-aospcodeline-cherrypick.png" alt="cherrypick"/></div><br/>

上游分支的提交 *E* 和 *F* ，会依次重新提交到下游分支，如果产生冲突，则**cherry-pick**失败，需要解决冲突后重新提交，直到产生新的提交记录 *E'* 和 *F'* 。
即使提交的代码改动一模一样，提交记录的SHA1(**Commit ID**)却已经发生了变化。

### rebase

**在downstream上，使用rebase,将downstream变基到upstream**

{% highlight console %}
$ git rebase upstream
{% endhighlight %}

<div align="center"><img src="/assets/images/aospcodeline/5-aospcodeline-rebase.png" alt="rebase"/></div><br/>

在downstream上使用rebase，表示要改变当前的基节点的位置，通过**rebase**到upstream，就意味着将基节点切换到upstream的最新提交 *F*。
本来downstream和upstream公共的父节点是 *B* ， 使用完**rebase**后，则会将 *C* 和 *D* 两个提交记录挑出来，重新提交到 *F* 之后，
这同样会生成两个新的提交记录 *C'* 和 *C'* ， **Commit ID** 与之前 *C* 和 *D* 的是不同的。

### merge

**在downstream上，使用merge，将upstream和提交合并到downstream**

{% highlight console %}
$ git merge upstream
{% endhighlight %}

<div align="center"><img src="/assets/images/aospcodeline/6-aospcodeline-merge.png" alt="merge"/></div><br/>

upstream和downstream两个分支**merge**，会出现一个新的提交 *M1* ， 它的父提交有两个，分别是 *D* 和 *F*。
如果产生冲突，则会一次性提示所有代码改动产生的冲突，这与**rebase**不一样，有一个很形象的比喻来形容**merge**和**rebase**进行代码合并的区别：

> 将一堆玩具整理到一个箱子中，**rebase**是一件一件挪，如果箱子满了(产生冲突),则需要整理一下箱子，腾出空间，再接着挪；
> 而**merge**是一股脑将玩具扔到箱子中，箱子满了，再一起整理。

不同于cherry-pick和rebase，采用merge时，upstream的**Commit ID**并没有发生变化，而是在downstream生成了一个新的提交记录，这一点非常重要。
再进一步考虑，基于downstream的提交记录 *D* 又拉了新的分支downstream2 ，并增加了新的提交 *H* , 仍然采用**merge**将upstream合并到downstream2:

<div align="center"><img src="/assets/images/aospcodeline/9-aospcodeline-merge-evolve.png" alt="merge-evolve"/></div><br/>

这时产生了一个新的合并提交 *M2* , 它的父提交是 *F* 和 *H* 。downstream和downstreanm2的公共父提交 *F*。
upstream合并到downstream2，相当于**(B, F, H)**的三路合并，在此之前，将upstream合并到downstream，相当于**(B, F, D)**的三路合并。
**E, F**与**C, D**合并可能会产生冲突，一旦冲突解决，则冲突解决的方法就被git记录下来了，再将**E, F**与**C, D, H**合并时，会利用之前解决的冲突，这样冲突数量会减少很多。
具体可以参见**git-rerere - Reuse recorded resolution of conflicted merges**机制。

随着upstream的不断演进，提交记录也会不断地**merge**到downstream和downstream2, 所有的下游分支的公共父提交始终都跟踪到上游分支的最新提交记录。
这有以下好处：

- **旧Android版本可以快速迁移到新版本**。假设upstream是设备厂商基于Lollipop构建的分支，downstream是基于Kitkat构建的某一个分支，
  一次merge就快速将Lollipop上的改动合并到Kitkat，实现旧版本的升级。如果downstream2是基于Kitkat的另一个分支，那么，downstream2升级的成本会更低，
  因为downstream升级时，解决的冲突能够被downstream2所用。

- **快速实现代码流变更**。downstream2本来是作为upstream的下游分支，它可以快速的切换为downstream的下游分支。只需要执行一次`git merge downstream downstream2`即可将代码流建立起来，从而实现代码流的分级，
  这能有效的兼容不同芯片平台的差异。假设upstream是设备厂商基于AOSP构建的分支，downstream和downstream2是基于MTK平台构建的分支。如果部分代码改动只适用于MTK平台，那么，就可以将代码流调整为
  downstream流向downstream2，只让一些公共的代码改动从upstream流向downstream。

- **避免无效的Gerrit Review**。设备厂商一般都会引入Gerrit代码审查，**Commit ID**保持不变，并不会增加新的Review任务，这在实现代码自动流时，能够减少人工的参与。

## 2.2 忽略不需要的变更

**cherry-pick**能够做到对每个提交记录的精准选择，但**merge**做不到，每一次**merge**都会合并上游分支的所有代码，然而实际的情况是，部分代码变更是不需要合并的，
所以，**merge**时还需要采取一定的策略来应对不需要合并的代码提交。

通过`git merge -s ours`这种方式能够将上游分支的提交记录合并到下游分支，仍然会在下游分支生成一个合并的提交记录，但实际上没有发生任何代码变更，
在下一次merge时，就只会合并从上一次merge以来的提交记录。这样一来，不仅略过了不需要的提交，而且还保持了分支合并的延续性。

要识别出哪些提交记录是略过的，就需要对这些提交记录进行标记，一个简单有效的方案是：通过提交描述(**Commit Comment**)中的关键字来标识该提交是否需要自动合并到其他分支。
譬如，可以将"DO NOT MERGE"作为关键字加到提交描述中，在自动合并代码时，检查一下待合并的提交记录，如果存在该关键字，就单独将这个提交挑出来，采用`-s ours`的方式进行**merge**。
假设上游分支有 **A、B、C、D** 四个提交，其中 **C** 不需要合并的，那么，在合并这些提交时，需要做三次**merge**：

- 第一次，git merge B，这会将合并 **A、B** 两个提交，代码会发生变更
- 第二次，git merge -s ours C，这会合并 **C** 一个提交，但代码没有变更
- 第三次，git merge D，这会和并 **D** 一个提交，代码会发生变更

# 3. 实现

采用**merge**进行分支合并相比其他方式更加适合代码流，然而要实现**自动**代码流，还需要考虑**merge**执行的时机，即什么时候自动地执行**merge**操作。
git是分布式的版本管理工具，对于Android而言，代码服务器作为远程服务端，每一个git的客户端需要与远程服务端进行代码同步。
当代码服务器有代码变更时，就需要触发分支合并，因此需要服务端架设一套自动代码流的工具，本方案称这套工具为**AutoMerger**。

## 3.1 利用钩子脚本

git提供一些钩子[2]，钩子是一个约定命名的脚本，服务端的钩子有三个：pre-receive、update和post-receive。

- pre-receive： 在将提交合入代码服务器之前，会调用该脚本一次。可以利用该脚本对提交内容做一些检查，譬如提交描述是否满足规范等。
- update：与pre-receive有点类似，但对于每个分支，都会调用该脚本。譬如有两个分支都收到了代码提交，那这个脚本就会被调用两次。
- post-receive: 在提交合入代码服务器之后，会调用该脚本。

设备厂商通常都会使用gerrit进行代码审查，gerrit也提供钩子[3]，其使用场景比git钩子更多。其他的代码审查工具一般也会提供对应的钩子。
钩子的实现原理不是本方案要讨论的内容，它只是执行自动代码流的时机，当一个分支有代码提交合入时，就需要执行`merge`操作，将提交记录合并到其他分支。

## 3.2 部署

在代码服务器上部署**AutoMerger**工具，它由钩子触发，一旦有代码合入就会执行**AutoMerger**

# 4. 总结

本文介绍了AOSP的代码管理方式，深入分析了代码自动流的技术方案，通过**merge**实现代码自动流，能够降低多分支的维护成本。
诚然，要真正做到有效的代码自动流，仅**merge**操作是不够的，需要在多分支之间搭建一套代码自动合并的方案，譬如：代码自动提交的触发时机、冲突的处理办法都是需要考虑的问题，
另外，丰富一下**merge**操作提交时的注释内容，也能够帮助我们更好的回溯问题。

本文对**merge**， **cherry-pick**和**rebase**操作进行了对比，但这只是在分支合并的场景下，并不是为了说明**merge**就是万能的。**cherry-pick**和**rebase**操作都是很有用的命令，
譬如在topic分支上进行开发，可以使用**rebase**命令与master分支保持同步，而且所有的提交记录都是线性的，不像**merge**操作一样，形成复杂的网状，网状的分支图会使得历史提交记录很难被追溯。

AOSP的代码自动流策略，还比较自然，不同Android版本之间的代码流起来，冲突也不会特别多，如果冲突很多，肯定也就说明问题来了，代码差异越大只会导致越来越难维护，这自然不是AOSP期望看到的。
对于设备厂商而言，面对的情况比**AOSP**要复杂，在跨Android版本、跨芯片平台的场景下，分支只会更多，差异也只会更大。

# 参考文献

[1] AOSP的代码线: https://
[2] git钩子: https://git-scm.com/book/en/v2/Customizing-Git-Git-Hooks
[3] gerrit钩子: https://gerrit-documentation.storage.googleapis.com/Documentation/2.11.3/config-hooks.html