{:title "Datomic: this is not the history you're looking for"
 :layout :post
 :tags  ["Datomic" "Architecture"]
 :toc true}

In this post, I'll describe some common pitfalls regarding the use of the 'time-travel' features of Datomic
 ([`db.asOf()`](http://docs.datomic.com/javadoc/datomic/Database.html#asOf-java.lang.Object-),
 [`db.history()`](http://docs.datomic.com/javadoc/datomic/Database.html#history--),
 [`:db/txInstant`](http://docs.datomic.com/transactions.html)).

We'll see that, unlike what many people think when they start using Datomic, these historical features of Datomic are not so useful for implementing
custom time-travel features in the business logic of applications - rather for generic database-related tasks.

I'll then try to describe the distinction between 'event time' and 'recording time', which is my analysis of what Datomic historical features essentially represent.

## A Datomic refresher

These are what I call the 'time-travel features' of Datomic in this post:
* [`db.asOf()`](http://docs.datomic.com/javadoc/datomic/Database.html#asOf-java.lang.Object-) lets you obtain a past version of the database at any point in time
* [`db.history()`](http://docs.datomic.com/javadoc/datomic/Database.html#history--) gives you a view off all the datoms (i.e facts) ever added to your database, even if they've been retracted since then
* [`:db/txInstant`](http://docs.datomic.com/transactions.html) annotates every transaction (i.e 'write') with the time at which it was processed.

Essentially, these features give you access to the past versions of the database - not just the present one.
 This makes it very tempting to use them for applications that need to provide time-related features of their own.
 As we'll see, this approach comes with significant caveats.

## The problem by examples

### Problem 1: accessing revisions of documents

Imagine for instance you're implementing some blogging platform on top of Datomic,
 and you want to give users the ability to view every past version of a blog post.
 Instinctively, since you're using Datomic, you'd want to reach out to `db.asOf()` for this task:

```clojure
(defn get-blog-post-as-of
  "Given a database value `db`, blog post id `post-id`, and time `t`,
  returns the version of the blog post as of `t`"
  [db post-id t]
  (d/pull (d/as-of db t)
    '[:blog.post/title
      :blog.post/content]
    [:blog.post/id post-id]))
```

This works fine at first, but then a few weeks later you add a new feature to your blogging platform: blog posts can
 be annotated with tags. So you add 2 new attributes `:blog.post/tags` and `:blog.tag/name` to your schema, and you ask
 an intern to annotate each of the existing blog posts by hand with some tags. The viewing code now looks like this:

```clojure
(defn get-blog-post-as-of
  "Given a database value `db`, blog post id `post-id`, and time `t`,
  returns the version of the blog post as of `t`"
  [db post-id t]
  (d/pull (d/as-of db t)
    '[:blog.post/title
      :blog.post/content
      {:blog.post/tags [:blog.tag/name]}] ;; we just added tags to the query
    [:blog.post/id post-id]))
```

The problem is, if you run this query for a `t` that is *before* when you transacted the new tag attributes, this won't work!
These attributes won't even be in the asOf database, not to mention the data associated with them.

The better way to do this would be to reify the versions of blog posts explicitly in your schema as *revision entities*, e.g:

```clojure
(defn get-blog-post-as-of
  "Given a database value `db`, blog post id `post-id`, and time `t`,
  returns the version of the blog post as of `t`"
  [db post-id t]
  (let [version-t
        (d/q '[:find (max ?t1) . :in $ ?post ?t :where
               [?version :blog.post.version/post ?post]
               [?version :blog.post.version/t ?t1]
               [(<= ?t1 ?t)]]
          db [:blog.post/id post-id] t)
        version-eid
        (d/q '[:find ?version . :in $ ?post ?t1 :where
               [?version :blog.post.version/post ?post]
               [?version :blog.post.version/t ?t1]]
          db [:blog.post/id post-id] version-t)]
    (d/pull db
      '[:blog.post.version/title
        :blog.post.version/content
        {:blog.post.version/tags [:blog.tag/name]}]
      version-eid)))
```

(Of course, this may not be the most storage-efficient way to represent blog posts - for a serious project, you may want to use a schema
  which leverages more structural sharing.)

### Problem 2: computing time series

Now imagine you're tracking what users of your blogging platform 'like' what blog posts.
 You may want to do this with using a `:user/likes-post` attribute.

Now, in order to display some statistics to the author, you want to count how many users have liked a post in a given time interval.
 It feels natural to do it using `:db/txInstant`:

```clojure
(defn count-post-likes-in-interval
  [db post-id t0 t1]
  (-> (d/q '[:find (count ?user) . :in $ ?post ?t0 ?t1 :where
             [?user :user/likes-post ?post ?t]
             [?t :db/txInstant ?time]
             [(<= ?t0 ?time)] [(< ?time ?t1)]]
        db [:blog.post/id post-id] t0 t1)
    (or 0)))
```

This works fine at first, but now imagine you have one of these requirements:

* you want to develop an "offline mode" for the mobile client of your platform, in which the likes will be persisted locally and merged back later.
* your company acquires another company, and decides to merge their blogging platform in yours, since yours so much better (thanks to Datomic, no doubt).

In both cases, it will be impossible for you to import the timing information, since Datomic doesn't let you set `:db/txInstant` to a past value.

The better way to do this would be to track the post likes with an explicit instant-typed attribute, for instance:

```clojure
(defn count-post-likes-in-interval
  [db post-id t0 t1]
  (-> (d/q '[:find (count ?user) . :in $ ?post ?t0 ?t1 :where
             [?like :like/post ?post] ;; notice how the like now has its own entity
             [?like :like/user ?user]
             [?like :like/time ?time]
             [(<= ?t0 ?time)] [(< ?time ?t1)]]
        db [:blog.post/id post-id] t0 t1)
    (or 0)))
```

## Taking a step back: event time vs recording time

What just happened here? We've just seen two very tempting uses of `db.asOf()` and `:db/txInstant`
 which turn out to be prohibitively constraining as your system evolves (schema growth, data migrations, deferred imports, etc.),
  because you have very little control over them.
 **Datomic does not let you change your mind about the information you encode in its time-travel features,** and that's usually too big a constraint.

This is not to mean Datomic time-travel features aren't useful - they're extremely valuable for debugging, auditing,
 and integrating to other data systems. But you should probably not implement your business logic with them -
 in particular, **if your system needs to offer time-related functionality, it should probably not be implemented using Datomic's own time-travel features.**

Of course, I can already here some protests: *Wait, I was told Datomic was great for keeping track of time!?*

I think the root of this issue is that we use the word 'time' to denote 2 essentially distinct concepts:

1. **event time**: the time at which stuff happened.
2. **recording time**: the time at which you're system *learns* that stuff happened.

*(Disclaimer: this terminology is totally made up by me as I'm writing this.)*

For instance: imagine you're saling on the Atlantic Ocean, in the middle of a storm. At 8:03 AM, a nasty wave wipes the deck clean
 and you have to swim back to the boat. At 6:12 PM, you're sitting comfortably in the cabin, writing in the boat's log:
 "At 8:03 AM, a nasty wave made me fall from the boat." 8:03 AM is the event time; 6:12 PM is the recording time.
 These are obviously 2 distinct times (which is a good thing, otherwise the boat's log would've ended up in the water).

Datomic, is great at reifying recording time, and giving you leverage over it.
 On the other hand, mainstream mutable databases have not really educated us to the distinction between event time and recording time,
 because they essentially give you no access to recording time, which makes the notion not very interesting.
 Finally, these notions are not specific to Datomic - they probably generalize to any event-sourcing system.

## What are Datomic historical features good for then?

In short, they're mostly useful for the generic 'technical housekeeping' of your system:

* **Preventing information loss:** you have an easy-to-query archive of every piece of information that was ever saved in your system - and you don't have to anticipate how you're going to leverage it.
* **Auditing:** you can know exactly when a piece of information entered your system and how it evolved in it (especially if you're [annotating the transactions](http://blog.datomic.com/2015/12/reified-transactions.html) in which these changes occurred).
* **Debugging:** you can reproduce the conditions of a bug at the time it happened.
* **Change detection:** answering 'what changed' questions, which is very valuable when integrating Datomic to 'derived data' systems.

Having said that, it's not entirely the case that Datomic's time-travel features don't help you manage event time - they do, precisely by preventing information loss.

For instance, let's go back to our 'users like posts' example.
Imagine that you've kept track of what users like which posts using the first approach, that is using a single `:user/likes-post` attribute.
Then you realize you'd like to keep track of when that happens, and therefore migrate to the second approach - that is, using an explicit 'like' entity.
Using `:db/txInstant`, you will at least be able to keep track of time for the likes you've collected so far - it's a bit hacky and might be inaccurate in some cases,
but it's much better than no information at all.

## Summary

If you're new to Datomic, you probably have the same misconceptions as I did regarding the use of Datomic's historical features.
* **bad news:** you've probably over-estimated the usefulness of these features for implementing your own specific time travel.
 Unless you really know what you're doing, I recommend you don't use `db.asOf()`, `db.history()`, and `:db/txInstant` in your business logic code.
* **good news:** you've probably under-estimated the usefulness of these features for managing your entire system as a programmer.

I believe the key to getting past this confusion is the distinction between **event time** (when things happened)
 and **recording time** (when your system learns they happened).

Finally, I advise you don't give too much importance to the time-travel features of Datomic - they're just the icing on the cake.
 *The main benefits of immutability don't arise from time travel; they arise from unlimited consistent reads, locally-scoped changes, easy change detection, and all that can be built on top of them.*