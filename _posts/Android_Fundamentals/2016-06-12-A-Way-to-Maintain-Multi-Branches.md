---
layout: post
category: Android系统原理
title: 一种Android多分支的自动合并方案
tagline:
tag: [多分支管理]
---

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

# 2. 分支合并方案

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

<div align="center"><img src="/assets/images/automerger/1-automerger-cherrypick.png" alt="cherrypick"/></div>

上游分支的提交 *E* 和 *F* ，会依次重新提交到下游分支，如果产生冲突，则**cherry-pick**失败，需要解决冲突后重新提交，直到产生新的提交记录 *E'* 和 *F'* 。
即使提交的代码改动一模一样，提交记录的SHA1(**Commit ID**)却已经发生了变化。

### rebase

**在downstream上，使用rebase,将downstream变基到upstream**

{% highlight console %}
$ git rebase upstream
{% endhighlight %}

<div align="center"><img src="/assets/images/automerger/2-automerger-rebase.png" alt="rebase"/></div>

在downstream上使用rebase，表示要改变当前的基节点的位置，通过**rebase**到upstream，就意味着将基节点切换到upstream的最新提交 *F*。
本来downstream和upstream公共的父节点是 *B* ， 使用完**rebase**后，则会将 *C* 和 *D* 两个提交记录挑出来，重新提交到 *F* 之后，
这同样会生成两个新的提交记录 *C'* 和 *D'* ， Commit ID与之前 *C* 和 *D* 的是不同的。

### merge

**在downstream上，使用merge，将upstream和提交合并到downstream**

{% highlight console %}
$ git merge upstream
{% endhighlight %}

<div align="center"><img src="/assets/images/automerger/3-automerger-merge.png" alt="merge"/></div>

upstream和downstream两个分支**merge**，会出现一个新的提交 *M1* ， 它的父提交有两个，分别是 *D* 和 *F*。
如果产生冲突，则会一次性提示所有代码改动产生的冲突，这与**rebase**不一样，有一个很形象的比喻来形容**merge**和**rebase**进行代码合并的区别：

> 将一堆玩具整理到一个箱子中，**rebase**是一件一件挪，如果箱子满了(产生冲突),则需要整理一下箱子，腾出空间，再接着挪；
> 而**merge**是一股脑将玩具扔到箱子中，箱子满了，再一起整理。

不同于cherry-pick和rebase，采用merge时，upstream的**Commit ID**并没有发生变化，而是在downstream生成了一个新的提交记录，这一点非常重要。
再进一步考虑，基于downstream的提交记录 *D* 又拉了新的分支downstream2 ，并增加了新的提交 *H* , 仍然采用**merge**将upstream合并到downstream2:

<div align="center"><img src="/assets/images/automerger/4-automerger-merge-evolve.png" alt="merge-evolve"/></div>

这时产生了一个新的合并提交 *M2* , 它的父提交是 *F* 和 *H* 。downstream和downstreanm2的公共父提交 *F*。
upstream合并到downstream2，相当于**(B, F, H)**的三路合并，在此之前，将upstream合并到downstream，相当于**(B, F, D)**的三路合并。
**E, F**与**C, D**合并可能会产生冲突，一旦冲突解决，则冲突解决的方法就被git记录下来了，再将**E, F**与**C, D, H**合并时，会利用之前解决的冲突，这样冲突数量会减少很多。
具体可以参见**git-rerere - Reuse recorded resolution of conflicted merges**机制[2]。

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

# 3. 自动化合并的实现

采用**merge**进行分支合并相比其他方式更加适合代码流，本方案基于此方式实现了一套自动化工具**AutoMerger**：

<div align="center"><img src="/assets/images/automerger/5-automerger-mechanism.png" alt="automerger mechanism"/></div>

对于上游分支的每一次提交，都会自动触发AutoMerger的执行，正常提交会采用`merge`的方式合并到下游分支;
如果某个提交注明不需要合并，则通过关键字判断(DO NOT MERGER)，采用`merge -s ours`的方式合并到下游分支。
如果在合并过程中发生了冲突，则需要通知提交人解决冲突。

要实现整套方案的**自动化**，要考虑的问题还很多：

1. 执行**merge**操作的时机;
2. 执行**merge**操作的冲突解决机制;
3. **AutoMerger**的部署和配置。

## 3.1 执行合并的时机

当上游分支有代码提交时，都需要通知**AutoMerger**。git提供一些被回调的钩子[3]，其实是一个约定命名的脚本，
服务端的钩子有三个：

- **pre-receive**： 在将提交合入代码服务器之前，会调用该脚本一次。可以利用该脚本对提交内容做一些检查，譬如提交描述是否满足规范等。
- **update**：与pre-receive有点类似，但对于每个分支，都会调用该脚本。譬如有两个分支都收到了代码提交，那这个脚本就会被调用两次。
- **post-receive**: 在提交合入代码服务器之后，会调用该脚本。

在代码服务器上实现**post-receive**这个脚本，就能监测到某个分支是否有代码提交操作，如果有，则通知**AutoMerger**，要将这个提交合并到下游分支了。

在使用Gerrit进行代码审查的环境下，也可以利用Gerrit提供了钩子[4]，其原理和git钩子大同小异。在服务器上实现Gerrit的**change-merged**脚本，也能达到与git的**post-receive**同样的效果。

## 3.2 解决冲突的机制

解决冲突，是AutoMerger的一项要求，否则，代码流就一直阻塞在冲突的地方。
因为**merge**会追溯两条分支的最近公共父节点，如果**merge**产生了冲突，那么本次就合并失败，两条分支的最近公共父节点没有发生变化，
下一次**merge**还是会追溯到相同的最近公共父节点，只要冲突不解决，那两条分支就一直无法合并。

解决冲突需要人工参与，需要遵循一定的原则，保证后续的**merge**操作能够正常执行。每次解决冲突，都要求采用同样的方式：

{% highlight console %}
$ repo sync .
$ git checkout downstream
$ git merge upstream
$ [本地解决冲突]
$ repo upload .
{% endhighlight %}

因为AutoMerger采用**merge**进行上、下游分支合并，所以，解决冲突时，也需要在上、下游分支之间执行一次`git merge`命令，
完全模拟AutoMerger的分支合并过程，人工解决冲突后，再将代码提交到下游分支。

git有自动解决冲突的机制，能够记录一些历史的冲突解决办法，下次遇到同样的冲突时，自动就将冲突解决了。这套机制减少解决冲突时的人工参与。

## 3.3 执行环境的部署

通常，部署Android开发环境都需要代码服务器来保存源码，开发人员都会在本地进行代码变更，并定期保持与代码服务器的同步。
AutoMerger可以部署在独立服务器、开发人员本地或代码服务器，都不会影响到其功能，下图示意将AutoMerger部署在独立服务器的场景：

<div align="center"><img src="/assets/images/automerger/6-automerger-deploy.png" alt="automerger mechanism"/></div>

在一个服务器上部署AutoMerger，该服务器需要具备以下能力：

1. 接收从代码服务器发出的代码合并通知;
2. 与代码服务器进行代码同步;
3. 通知冲突责任人解决冲突。

AutoMerger收到代码服务器的代码提交通知后，便从代码服务器拉取最新的代码，将提交从上游分支合入下游分支;
如果没有产生冲突，则将下游分支的代码提交到代码服务器; 否则，通知提交人产生的冲突;
冲突责任人在收到通知后，遵循约定的方式解决冲突，再次向代码服务器提交代码。

# 4. 总结

本文对比了**cherry-pick**、**rebase**和**merge**这三种分支合并方式的区别，
基于**merge**的方式设计了一套多分支合并的方案，称为**代码流**。
通过部署AutoMerger这个工具，能够选择性地将上游分支的代码提交自动合并到下游分支。
分支合并过程中间产生的冲突，需要人工参与解决，AutoMerger能够及时地发现并通知冲突责任人。

AutoMerger已经经过了多个Android开发团队的验证，能够有效的降低多分支维护的成本，提高设备厂商升级Android版本的效率。

---

# 参考文献

1. AOSP的代码线: <http://source.android.com/source/code-lines.html>
2. git-rerere自动解决冲突机制：<https://git-scm.com/blog/2010/03/08/rerere.html>
3. git钩子: <https://git-scm.com/book/en/v2/Customizing-Git-Git-Hooks>
4. gerrit钩子: <https://gerrit-documentation.storage.googleapis.com/Documentation/2.11.3/config-hooks.html>
