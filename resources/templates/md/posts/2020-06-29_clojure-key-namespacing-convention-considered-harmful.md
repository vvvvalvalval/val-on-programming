{:title "Clojure's keyword namespacing convention Considered Harmful"
 :layout :post
  :tags  ["Clojure" "Programming" "Architecture"]
  :toc true
  :date "2020-06-29"}

Thank you for taking the bait of this inflammatory title. I promise you that the rest of the article will be more reasoned and nuanced, even though the issue at hand is definitely pedestrian and annoying.

**_In summary:_** for far-ranging data attributes, such as database columns and API fields, **I recommend namespacing keys using 'snake case', contrary to the current Clojure convention of using 'lisp-case' (for example: favour `:myapp_user_first_name` over `:myapp.user/first-name`)**, because the portability benefits of the former notation outweigh whatever affordances Clojure provides for the latter. This is an instance of trading local conveniences for system-wide benefits.

You may already be convinced at this point, in which case the rest of this article will be of little value to you. Otherwise, I want to provoke you to go through the following mental process:

1. **Consider `:namespacing_keys_in_snake_case` for data attributes** in Clojure, rather than the conventional `:namespacing.keys/in-lisp-case`.
2. **Get angry**, because that's disgusting to any self-respecting Clojure-bred programmer.
3. Recognize that you're angry because you've got **attached to an arbitrary convention,** and superficial ergonomics around it.
4. Optional: try to bargain with reality, by attempting to find some hacky mechanisms to keep both notations around. Realize that it's not satisfactory.
5. Give up, be at peace, and reap the benefits of designing your programs **system-first rather than language-first**.

I went slowly through this process myself, with some maintenance pains in the way, which hopefully this article can spare you.



## The great benefits of namespaced keys

First, it's worth emphasizing that **the naming of data attributes is an important issue, however innocuous it may feel.** Data attributes such as database columns or API fields are not only the bread and butter of our code, they're also some of the strongest commitments we make when growing an information system, often stronger that the choice of programming language. Once a data attribute is part of the contract between several components the system, it becomes very hard to change. This is true even of small systems such as web or mobile apps.

In recent years, Clojure has encouraged the programming convention of conveying data using _namespaced_ keys, e.g using `:myapp.user/id` rather than just `:id`. Namespacing is great, because by reducing the potential for name collisions, it eliminates a lot of ambiguity about names.

The **significant benefits** of this approach are:

1. **context-free readability:** when you see `:myapp.user/id` in your code, thanks to the `myapp.user` part, you can tell immediately what kind of data it conveys, and what type of entity it operates on. If you just saw `:id`, you'd have to figure that out from context.
2. **data traceability:** with a simple text search in the code, you can immediately follow all the places where this piece of data is used across your entire system, whatever the language used at each place. This basic ability is significantly helpful for maintenability. I think many developers don't realize how big a difference it makes.

Observe that these benefits apply regardless of the choice of namespacing notation: you would reap them whether you write `:myapp.user/id`, `:myapp-user-id`, `:myappUserId` or `:myapp_user_id`. **It does not matter which namespacing notation you choose, as long as you use it everywhere.**

In other languages, programmers have traditionally relied on type systems to remove such ambiguity. Type systems are not as good for this purpose, because they don't reach beyond language boundaries.

Clojure's specific convention also offers some comparatively **insignificant benefits:**

* **prettiness:** _"look at `:myapp.user/first-name`, it's so beautiful! I can use slashes and dashes in programmatic names, this is THE POWER OF LISP!"_
* **concision affordances:** in Clojure code, using namespace aliases, you can write `::user/first-name` as a shorthand for `:myapp.user/first-name`. Big deal. I mean, I can relate to how pleasing this feels when coding, but again, please consider that thinking of the whole system may be more important than this sort of local preferences.


## Advantages of 'snake case': portability and ubiquity

In a real-world system, data attributes are bound to travel through many media: SQL columns, ElasticSearch fields, GraphQL fields, JSON documents... if the system involves other languages as Clojure, they may be represented as class members. As mentioned above, using the same name - spelled in _exactly_ the same way - for the data attribute in all these representations is a precious thing, because you can trace it across your codebase with one basic text search. You can track its usage not only in Clojure code, but also in SQL queries, ElasticSearch queries, JavaScript client code, etc.

Clojure's conventional notation for keys (e.g `myapp.person/first-name`), **a.k.a lisp-case, is portable to almost none of these other platforms:** it's not suitable for SQL column names, nor for GraphQL field names, nor for ElasticSearch fields, nor for Java/Python class members... Some people have argued that in those systems you should just drop the entity-name part (`myapp.person`), as it will be represented in another construct such as the SQL table name, but that's generally misguided IMO, because you're back to having to disambiguate meaning from context, and you're making the fragile assumption that colocated keys should always have the same entity-name part (think e.g of `:myapp.person/name` and `myapp.admin/password`).

On the other hand, as far as I can tell, **it's hard to come by a platform that does not support `snake_case`.** Using it may not always be idiomatic, but it's almost always supported. That's reason enough to make snake_case a better default, because having one ubiquitous notation is much preferrable to having many locally idiomatic ones.




## Frequent objections


### 'This is not idiomatic Clojure'

Your programs have more important requirements than being idiomatic. Programming history is riddled with bad design decisions made in the name of being idiomatic. Anyone who's worked through a nasty Scala class hierarchy knows how much incidental complexity some programmers are willing to inflict upon themselves for the sake of being idiomatic (_"because it's SO much better to write `subject.verb(complement)` than `verb(subject, complement)`. It's more idiomatic, you see."_). Let's avoid doing that to your program, or the Clojure ecosystem.



### 'The lisp-case convention lets me destructure keywords'

_I like the ability of destructuring my keywords into an entity-name part and an attribute part, for instance:_

```clojure
(namespace :myapp.user/first-name)
=> "myapp.user"

(name :myapp.user/first-name)
=> "first-name"
```

_I can leverage that to manipulate my data attributes generically in my programs._

Don't do that. Don't treat Clojure keywords as composite data structures. This is accidental complexity waiting to happen. Programmatic names are meant for humans to read, not for programs to interpret. Changing an attribute name should not be able to change the behaviour of your program. In Hickeyian terms: you'd be complecting naming with structure.

As a basic example of how this may break, consider that it's normal and expected to find in the same entity keys with different namespaces, e.g `:person/first-name` and `:myapp.user/signup-date`.


### 'But clojure.spec encourages the use of Clojure-namespaced keywords!'

Yeah... I know. In a way, Clojure Spec does what I've told you not to do in the previous section: relying programmatically on a naming convention for keywords, as Spec expects the keys you register to be Clojure-namespaced. Pushing further in that direction would be, in my opinion, a design error of clojure.spec.

That said, clojure.spec does quite sensibly make room for other namespacing conventions (via `:req-un` and `:opt-un`), and so clojure.spec is compatible with the recommendation this article is making. The semantics of Clojure Spec would be completely broken if name collisions were allowed, and so it's understandable that it's decided to check for namespacing.


### 'This will create inconsistencies in our code style'

**What might worry you:** some parts of your code might be forced to use keywords in lisp-case - for instance, because libraries like Integrant impose them on you. Having these keys in lisp-case and other in snake_case might be disturbing.

If that's troubling you, you're in for a pleasant surprise: the visual constrast between `snake_case` and `lisp-case` actually makes the code _more_ readable, because it's signals which keys are meant for local use and which are meant to travel across the system.

By the way, you have already seen an instance of readability enhanced by contrasted notation: in Clojure's syntax itself, where parens `(... )` are used to denote invocations, and square brackets `[... ]` are used to denote lexical bindings, departing from the Lisp tradition of using parens for everything.

Again, I don't want to put too much emphasis on this aspect, because I think it's a relatively minor issue. Even without this bonus point, `snake_case` would be preferrable.


### 'But I can just write a key-translation layer at the edge of my Clojure program...'

... and then you'd lose the main benefit of namespacing, which is the ability to track a data attribute across your entire system rather than just one component of it.

Allow me to insist: the global searchability of programmatic names is much more important than their conformance to local naming customs.



## Conclusion

This article makes 2 unintuitive claims: that the choice of notation for namespaced keys matters, and that the one used conventionally in Clojure is often suboptimal. It proposes to replace it with `:snake_case`, the main drawback being that it looks ugly and awkward, which seems like a good deal as design tradeoffs go.

2 years ago, I opened a [discussion on ClojureVerse](https://clojureverse.org/t/should-we-really-use-clojures-syntax-for-namespaced-keys/1516) questioning the use of Clojure's namespacing convention. Objections were raised, but none that convinced me or brought up issues I had overlooked, and I'm now confident that this article makes the best default recommendation.

In my experience, this proposal tends to be met with reluctance, and remembered without regrets. I myself came to it begrudgingly (a coworker once phrased it well: _"I hate it, but it's right."_) Clojure developers program with love, and love drives us to cherish little idiosyncrasies. That said, I find it paradoxical that most of the resistance to this idea was along the lines of favouring 'local-language convenience', in a community where talks like _[The Language of the System](https://www.youtube.com/watch?v=ROor6_NGIWU)_ and _[Narcissistic Design](https://www.youtube.com/watch?v=LEZv-kQUSi4)_ have championed as higher principles the adaptability and friendliness to a varied surrounding system.

I hope the ideas presented here can help you program your systems smoothly and harmoniously. Thank you for reading!