---
layout: page
title:
tagline:
---

{% include JB/setup %}

最近更新
===

<ul class="posts">
  {% for post in site.posts %}
    <li><span>{{ post.date | date_to_string }}</span> &raquo; <a href="{{ BASE_PATH }}{{ post.url }}">{{ post.title }}</a></li>
  {% endfor %}
</ul>

<br/><br/>

转载声明
===

<font size="4"><b>博客内容均属原创，欢迎转载，请注明出处:</b></font><br/>

 **原文内容**：duanqz.github.io
 
 **作者邮箱**：duanqz@gmail.com
