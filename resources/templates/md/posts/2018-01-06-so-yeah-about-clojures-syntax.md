{:title "So yeah, about Clojure's syntax..."
 :layout :post
 :tags  ["Programming" "Clojure"]
 :toc true
 :date "2018-01-06"}

For many experienced programmers, the first encounter with Clojure's syntax ranges from slightly disturbing to downright _shocking._

> Why on Earth would you put the function _inside_ the parens? That's just _weird!_

We programmers can get very emotional about syntax. I guiltily remember my Java days, and how I enjoyed the ceremony of typing
 things like `protected final void etc(){...}`. But we also need to be pragmatic, and if we're able to overcome these subjective biases,
 we can make more lucid technical decisions.

So the goal of this article is to help you understand _why_ some of us choose to leave the familiar comfort of C-style syntax
  for this strange world of brackets and parentheses - and how rewarding it can be.

**Disclaimer:** this article does not try to _prove_ the benefits of Clojure's syntax - merely to communicate my perception of them.
 I believe the right tool for assessing language design is experience using it, not rethorics :)

## Does syntax matter?

First, let me start by saying this: **syntax is NEVER a good reason to use or dismiss a programming language.**
 If your approach for choosing a language is 'I (don't) like the syntax', you're doing it wrong.
 The semantics of a language, its execution model, its ecosystem, its performance characteristics, etc. are much more
 important factors.

Developers face many technical difficulties when building real-world systems; the most painful of these difficulties tend
 to last fo years and get worse over time. So if being unfamiliar with some language syntax is your most painful problem
 at work, I envy you, because you can be 100% confident that this problem will be over in a matter of days :).

Does this mean that syntax does not matter for language design? Of course it matters!
 Syntax matters, because it encourages or inhibits certain
 programming idioms. You _could_ write Java programs in the same style as Clojure programs, but that would be extremely
 unwieldy, to the point that no team would be willing to sustain such an effort (not to mention a whole ecosystem).

As we'll see, Clojure's syntax is an enabler for many desirable things.

## The ingredients of Clojure's syntax

### Data literals

The textual syntax of Clojure is actually just a notation for data structures. You can think of it as 'JSON on steroids':
 less verbose (commas are optional), richer and extensible set of data types, maps can have arbitrary keys, etc.

Examples in code:

```clojure
; comments are preceded by a semicolon ';'

;;;; scalar types

0 -1 2048 3.14 3/4 6.022e23 ;; numbers
true false ;; booleans
nil ;; null / nothing
"hello" ;; strings
"multi
line
string"
;; Clojure has 2 symbolic types: keywords and symbols
:a :hello :org.my-company/foo ;; keywords - programmatic identifiers, a bit like enums, 'represent themselves', often used as keys in maps
a hello fn my.ns/foo-bar ArrayList + * - <div> ;; symbols - typically used to 'name' some other value

;;;; collection types

;; lists: sequential collections that 'grow at the front', delimited by parentheses (...)
(1 -2 42) ;; a list of 3 numbers
(:a :b :c) ;; a list of 3 keywords
(:a b "c" :d 42) ;; lists can be heterogeneous
() ;; the empty list
(() (:a b)) ;; a list of 2 lists
(x
 :y
 "z") ;; can span multiple lines

;; vectors: also sequential collections, but 'grow at the end', and support random access (like arrays), delimited by square brackets [...]
[1 -2 42]
[:a b "c"]
[]
[()[][()]]
[1
 2
 3]

;; maps: sets of key-value pairs (a.k.a 'dictionaries' or 'hashes' in other languages), delimited by brackets {...}
{:k1 "v1" :k2 "v2" :k3 "v3"} ;; a map of 3 key-value pairs; in this case, the keys are keywords, and the values strings
{:k1 "v1", :k2 "v2", :k3 "v3"} ;; you can add commas if they make you feel better; in Clojure, commas are whitespace.
{} ;; empty map
;; keys and values can be of any type, the only constraint is that keys must be distinct
{:k1 :v1
 "k2" v2
 k3 [:v 3]
 [] (1 2 3)
 12 nil
 :a {:b :c
     :d [:e :f]}
 nil true}
```

So the Clojure compiler does not really compile text: instead, it compiles data structures, each data structure being
 treated as an expression. Consider for example this code:

```clojure
(defn square [x]
  (* x x))
```

In terms of syntax, this is actually a _list_ of 4 elements:

```clojure
(defn    ;; the symbol 'defn'
 square  ;; the symbol 'square'
 [x]     ;; a vector of 1 element, which is the symbol 'x'
 (* x x) ;; a list of 3 elements (all symbols)
)
```

When these data structures are 'executed', some data types are evaluated using some special rules:

- **symbols** are evaluated to the value that they 'name' (a function parameter, or a global constant, or a local variable, etc.)
- **lists** (example: `(op x y z...)`) represent 'invoking an operation': by default invoking a function (e.g
 `(myfun x "y" 42)` is equivalent to `myfun(x, "y", 42)` in C-style syntax), but sometimes another sort of operation.

For instance, `(defn my-fun [x y] ...)` is the operation: 'define a function named `my-fun`, that has 2 arguments `x` and `y`, etc.'

In particular, these special operations can be _macros_, which we'll describe in the next section.

### Macros

As explained above, in Clojure, some of the operations that you call with lists are evaluated specially.

A handful of these special operations are built-in to the language, and called _special forms:_,

```clojure
;;;; examples of special forms

;; def - creates a named global constant
(def my-constant 42)

;; let - names local values
(let [x 3
      y 4]
  (+ x y))

;; if - control flow, evaluates one expression or the other depending on the first expression's value
(if (even? n)
  :even
  :odd)

;; fn - creates an anonymous function, or 'lambda'
(fn [x]
  (* x x))
```

All the other special operations are **macros**.

Macros essentially _rewrite_ the code that you pass to them to other code: just like a function accept values and return
 a value, a macro accepts code expressions and return a new code expression.

For instance, in Clojure, the `or` operator (equivalent to `||` is C-style languages) is a macro that emits code using
 the lower-level `if`:

```clojure
;; the following expression, which uses the 'or' macro:

(or x y z)

;; ...expands to something like:

(if x
  x
  (if y
    y
    (if z
      z
      nil)))
```

Importantly, in Clojure, **the programmer can define her own macros**
 (using [`defmacro`](https://clojuredocs.org/clojure.core/defmacro); we won't delve into how to use it,
 as that would require a proper Clojure tutorial, but it's basically just like defining a function).

**Some observations about macros:**

1. Macros accept code expressions _as data structures_, and return a code expression _as a data structure_.
 So defining a macro consists simply of defining a function that manipulates data structures (which is what programmers
 do every day).
2. This 'syntax as a data notation' aspect exists precisely to make macros easy to write
3. Macros essentially let you attach 'nex meanings' to syntax.
4. You can think of macros as giving you the opportunity to transform the [AST](https://en.wikipedia.org/wiki/Abstract_syntax_tree)
 of the program during compilation (more accurately, its Concrete Syntax Tree).
5. Macros enable 'zero-cost abstractions', i.e abstractions that have no runtime performance cost (since they operate at
 compile-time).
6. Macros can do anything to compute the returned expression: use previously-defined functions, make network calls, call a database, etc.
7. LISP-style macros aren't the same thing _at all_ than C/C++-style macros: don't judge the former because you've been bitten by the latter :)

If you want to know more precisely how this all works, I recommend reading [the reference on clojure.org](https://clojure.org/reference/evaluation).

## Consequences

### Verbosity is a solved problem

The first consequence of having concise data literals and macros is that verbosity never gets in your way when programming:
 whatever the program design you're considering, you know the code will never 'get too tedious', because you will be able
 to factor out the repetition and noise from the code (more often by using existing macros than by using new ones).

A famous example is GUI programming in Java using the Swing toolkit, which is knowingly tedious, especially when nesting components.
 The following code uses the `doto` macro to achieve more concision and clarity than the Java equivalent, while still embracing
 the original Swing API:

```clojure
(doto (JFrame.)
  (add (doto (JLabel. "Hello World")
         (setHorizontalAlignment SwingConstants/CENTER)))
  pack show)
```

The Java equivalent would be:

```java
JFrame f = new JFrame();
JLabel l = new JLabel("Hello World");
l.setHorizontalAlignment(SwingConstants.CENTER);
f.add(l);
l.pack();
l.show();
```

Data literals also work towards this goal at a higher level: by encouraging you to write programs mostly as data instead of code,
 which makes them fundamentally more flexible, regular, and easier to operate and instrument. Data literals, by helping you
 embed data in code, make for a smooth transition from code to data.

A nice example of this is Datomic's [Datalog](http://docs.datomic.com/query.html), the main query language for the Datomic database.
 Writing Datalog using Clojure data literals is no less concise than SQL, but it's much more _programmable_: for instance,
 generating advanced Datalog queries is much easier and more fool-proof than generating SQL queries. Example:

```clojure
(ns movies-example
  (:require [datomic.api :as d]))

;; example 1: a simple ordinary query
(defn actors-of-movie
  "find all actors who played in the given movie"
  [db movie-id]
  (d/query
    ;; this is Datolog, embedded in Clojure code using data literals
    '{:find [[?actor ...]]
      :in [$ ?movie-id]
      :where
      [[?movie :movie/id ?movie-id]
       [?actor :person/acted-in ?movie]]}
    db movie-id))

;; example 2: generating a Datalog query
(defn movies-with-all-actors
  "Finds the movies starring all the given actors"
  [db actors-ids]
  (let [inputs (->> actors-ids
                 (map-indexed (fn [i actor-id]
                                [(symbol (str "?actor-" i))
                                 actor-id])))
        q {:find '[[?movie ...]]
           :in (concat '[$] (map first inputs))
           :where
           (for [?actor-i (map first inputs)]
             [?actor-i :person/acted-in '?movie])}]
    (apply d/query q
      db (map second inputs))))
```

A more extreme example of this philosophy is the [Onyx](http://www.onyxplatform.org/) data processing platform,
 which lets you express entire workflows using just data.

### Separation of concerns: code layout ⊥ program structure

There is more to macros than just eliminating boilerplate: macros enable you to design your programs without having to
 anticipate how the calling code is going to look, making these independent choices.

So you could say **macros separate 2 concerns:**

* **program structure** (writing programs which are reusable, flexible, composable, decoupled etc.)
* **code look and feel** (clarity, concision, organization, visual layout etc.)

#### Example: the Builder Pattern

What happens when these concerns are not separated? Then programmers face dilemmas, which drag away their focus from
 essential problems. One of these dilemmas is whether or not to use the [Builder Pattern](https://en.wikipedia.org/wiki/Builder_pattern).
 Let's see an example of that

[UnderscoreJs](http://underscorejs.org/) is a popular JavaScript library providing utilities for manipulating collections.
 Examples:

```javascript
var _ = require('underscore');

var numbers = _.range(100);

// keep only the even numbers
_.filter(numbers, function(n){return n % 2 === 0;});

// squaring the numbers
_.map(numbers, function(n){return n * n;});

// summing the numbers
_.reduce(numbers, function(sum, n){return sum + n;}, 0);
```

These functions are powerful, but chaining them can be impractical. Continuing with our example, imagine you want to sum
 the squares of even numbers smaller than 100:

```javascript
_.reduce(
  _.map(
    _.filter(
      _.range(100),
      function(n){return n % 2 === 0;}),
    function(n){return n * n;}),
  function(sum, n){return sum + n;},
  0);
```

You see the readability problem with this code: it displays the operations as nested from the inside out, when we think
 of them as successive.

UnderscoreJs addresses this problem by providing a `chain` operation, which uses the Builder Pattern to make the code
 'look' chained:

```javascript
_.chain(_.range(100))
 .filter(function(n){return n % 2 === 0;})
 .map(function(n){return n * n;})
 .reduce(function(sum, n){return sum + n;}, 0)
 .value();
```

This approach solves the surface readability problem, but brings new, deeper problems:

* The set of operations available in a `_.chain() (...) .value()` context is not extensible, making it hostile to abstraction.
 For instance, you can no longer contract the 'square' and 'sum' steps into a single 'sumSquares' step - which you could
 easily do when using plain old functions.
* The source code of the underlying operation is much harder to write and reason about. How long would it take you to
 re-implement a robust version of `_.chain`?

Now let's see how Clojure does when applied to the same problem. Clojure's standard library provides similar functions
 to UnderscoreJs:

```clojure
(def numbers (range 100))

(filter (fn [n] (= (mod n 2) 0)) numbers)

(map (fn [n] (* n n)) numbers)

(reduce + 0 numbers)
```

Chaining these functions calls directly by nesting them looks just as messy as it did in JS:

```clojure
(reduce + 0
  (map (fn [n] (* n n))
    (filter (fn [n] (= (mod n 2) 0))
      (range 100))))
```

However, Clojure gives us a very nice tool for solving the readability problem: the [`->>`](http://clojuredocs.org/clojure.core/-%3E%3E)
(pronounce: 'thread last') macro:

```clojure
(->> (range 100)
  (filter (fn [n] (= (mod n 2) 0)))
  (map (fn [n] (* n n)))
  (reduce + 0))
```

This code is much clearer, and I want to emphasize that `map`, `filter` and `reduce` are exactly the same functions here as
 we used above. Actually, all `->>` does is 're-write' the code in the previous, messy form, as we can verify using `macroexpand`:

```clojure
(macroexpand
  '(->> (range 100)
     (filter (fn [n] (= (mod n 2) 0)))
     (map (fn [n] (* n n)))
     (reduce + 0)))
=> (reduce + 0 (map (fn [n] (* n n)) (filter (fn [n] (= (mod n 2) 0)) (range 100))))
```

`->>` is also fairly easy to implement: all you have to do is think of the expressions as data structure, and
 re-arrange them to the desired form. Here's an implementation off the top of my head:

```clojure
(defmacro ->>
  [start & more]
  (reduce
    (fn [inner outer]
      (let [outer (if (list? outer) outer (list outer))]
        (into (list inner) (reverse outer))))
    start more))
```

What's neat about the above solution is that **we haven't compromised at all on program structure in order to make the code pretty.**
 We just composed 2 orthogonal tools, each solving a separate concern:

* a **syntactic tool** (the `->>` macro) to solve a syntactic problem (organizing the code visually)
* a **semantic tool** (the `map` / `filter` / `reduce` functions) to make a correct, well-structured program.

### Code = Data = Data Viz

There's a famous Lisp aphorism that _'code is data'_, meaning that the syntax for Lisp is a _notation_ for data structures
 that can easily be manipulated by the language (after all, LISP stands for LISt Processing). In the case of Clojure, these
 data structures are lists, vectors and maps. This is what makes macros so easy to write in Clojure.

Another aspect of Clojure's syntax, as we saw above, is that it's a very human-friendly notation for structured data.
 As such, Clojure's syntax is a good tool for doing **both data reprensentation and data visualization.**

This last aspect is critical to Clojure's interactive development story. When you evaluate an expression at the Clojure
 REPL, the result is presented to you in Clojure's syntax: this makes it easy to analyze (especially when pretty-printed
 and syntax-highlighted), but it also makes it immediately available as a code expression, to be reused for further exploration
 or persisted in source files.

[<img src="/img/repl.gif" width="100%"></img>](https://vimeo.com/230220635)

### Tooling as libraries

When you have macros, a huge part of the external tools that are commonplace in other languages become obsolete.
 Macros are typically used as a replacement for:

* source code generation / transformation
* debugging tools
* syntax entensions / 'transpilers'
* bytecode manipulation
* annotations
* documentation generation

Macros have several advantages in this area:

* they're easy to install, since they're available as libraries
* they're portable (a macro is not limited to Build Tool X or Editor Y or Framework Z)
* they require little effort to create (it typically takes a few week-ends to a lone developer to make such a library,
 not a few months to an engineering department at a big company)

<div class="my-tweet-wrapper">
 <blockquote class="twitter-tweet" data-lang="en"><p lang="en" dir="ltr">
 “I don’t need macros, they’re too complicated and not useful,” says the programmer as they use Flow with JSX with Babel with two dozen plugins and maintain two hundred line webpack configs for code with machine-checked comments that parses CSS in template strings at runtime and—</p>&mdash; Alexis King (@lexi_lambda)
 [January 3, 2018](https://twitter.com/lexi_lambda/status/948435311058599936?ref_src=twsrc%5Etfw)
 </blockquote>
</div>

### An 'all-tracks' language: embedding paradigms

Every non-trivial applications sooner or later reaches a point where it cannot be served well
 with just one programming paradigm. Some part of your program may need a declarative way of
 building UI trees (HTML templating / PHP / JSP / ERB / etc.), whereas another just needs some
 procedural glue. Some parts of your business logic may be well expressed in a functional style,
 when some other would benefit more from using logic programming (Prolog, MiniKanren) or
 a production rules system. Some computation may need an imperative algorithm (e.g in C), when others
 are best expressed as graphs of computational steps.

Because Clojure's syntax is not opinionated about semantics (remember, it's just data structures),
 it welcomes any programming paradigm; and because it's so programmable (again, it's just data structures),
 it lets users provide implementations of those paradigms as libraries (either by building interpreters for structures,
 or via macros).

The 'default' paradigm of Clojure is dynamically-typed, functional programming, i.e lambda-expressions
 evaluating to generic, immutable data structures, or functions of those. However, many other paradigms
 are available as libraries, for example:

* Logic programming ([core.logic](https://github.com/clojure/core.logic))
* Production rules ([Clara Rules](http://www.clara-rules.org/))
* ML-style Pattern Matching ([core.match](https://github.com/clojure/core.match/wiki/Overview))
* 'DAG computing' ([Plumatic/Graph](https://github.com/plumatic/plumbing#graph-the-functional-swiss-army-knife))
* SQL querying ([HoneySQL](https://github.com/jkk/honeysql))
* Golang-style CSPs ([core.async](https://github.com/clojure/core.async))
* Static type checking ([core.typed](https://github.com/clojure/core.typed))
* HTML templating ([Hiccup](https://github.com/weavejester/hiccup)), CSS ([Garden](https://github.com/noprompt/garden))

Having one syntax to host all these paradigms makes it much more practical to compose them together,
 because their implementations can **share a lot of the language's infrastructure** (runtime, editors, tooling,
 dependency management, code modularization, etc.)

You could however argue that having different syntaxes for different paradigms is beneficial,
 because using them in separate source files forces programmers to separate concerns.
 That's not the case in my experience, because **in a typical program, different paradigms don't address different concerns, rather different aspects of the same concern.**

#### Example: Web UIs

For example, one of the biggest lies that are told to novice Web programmers is that
 HTML, CSS and JavaScript are respectively for content, style and logic. For today's web
 applications, this is not true at all, and trying to enforce this separation actually creates
 much more complexity than it eliminates. The reasons for this separation are actually historical;
 the modern best practice is to separate UI into _components_, each component having its own
 DOM templating, styles and logic. In the JavaScript world, inline styles and JSX are approaches
 for co-locating them in code.

Here's an example of such a component in ClojureScript, from one of my personal projects.
 Note that this is just plain old Clojure: no build tooling is involved in making this work.

```clojure
(ns m12.widgets.gtab
  (:require [rum.core :as rum]
            [m12.widgets.ui-toolkit :as utk])
  (:require-macros
    [rum.core :as rum :refer [defc defcs]]]))

;; a 'guitar tablature' component
(defc <guitar-tab> < rum/static rum/reactive
  [props
   {:as opts, :keys [n-strings length string-heights]
    :or {n-strings 6}}
   items content]
  (let [strings-items (group-by ::string items)]
    [:div.gtab props
     (for [i (range n-strings)]
       [:div.gtab-string {:key (str "gtr-string-" i)}
        [:div.gtab-string-inner
         (->> (strings-items i)
           (map-indexed
             (fn [k {:as item, x ::x}]
               [:div.gtab-item
                {:style {:left (str (* 100 (/ x length)) "%")}
                 :key (str "gtab-item-" k)}
                (content item i)]
               )))]
        (when-let [h (get string-heights i)]
          [:div.gtab-item.gtab-string-height
           [:div.gtab-note (utk/<height> h)]])])]))

;; ...
```

### Saner language stewardship

History has shown than one of the most important guidelines in developing a programming language
 is preserving its ability to evolve, because language developers cannot anticipate all the future
 needs of their users. Guy Steele articulated this very well in his talk
 [Growing a Language](https://www.youtube.com/watch?v=_ahvzDzKdB0).

<iframe width="560" height="315" src="https://www.youtube.com/embed/_ahvzDzKdB0" frameborder="0" gesture="media" allow="encrypted-media" allowfullscreen></iframe>

Macros play an interesting role in this regard, because they essentially enable users to 'add features'
 to the language. For instance, Clojure does not natively ship with ML-style pattern matching, encouraging
 instead a combination of destructuring and polymorphism (via [multimethods](https://clojure.org/reference/multimethods)).
 However, the [core.match](https://github.com/clojure/core.match/wiki/Overview)
 library provides a macro for pattern-matching when that's really a better fit.

Macros have the implication that, if some Clojure users are missing some language features for a particular project,
 they can write it themselves right away, instead of having to lobby the core developers of the language.
 They can make this new feature available as a library, and if not everyone agrees that this feature is beneficial, well,
 not everyone has to use the library. Eventually, there may be a consensus that this feature should be added
 to the core of the language, and by that time there will be empirical evidence that it's really useful. It also
 means that the language developers can focus on the long-term, strategic evolutions of the language, instead
 of solving the specific, short-term needs of their users.

What happens when users can't extend the language? Then language developers take various approaches
 to handle requests from the users. Some languages are very conservative and just leave their users wanting,
 which is bad enough, especially when it leads the users to hack around this limitation by adding 'language features'
 via tooling (see for example the proliferation of 'transpiler' plugins in the JS ecosystem).

Some languages take the opposite approach and will add new language features as quickly as possible,
 which is even worse. **Adding features too readily to the core of a language will please some users on the short term, but can have very bad consequences to its ecosystem on the long term:**

* It adds complexity to the language, which makes it harder to learn for beginners and harder to maintain
 for language developers
* It creates a 'combinatorial explosion' of programming styles, which paralyzes programmers when writing code
 ("Should I use a lambda for this? Or maybe a block? Or maybe a subclass? ...") and puzzles them when reading
 code written by others
* Some language features seem like elegant ideas, then experience proves they're just harmful
* As more and more features get added, the 'idiomatic way' to code evolves significantly, encouraging
 major (often breaking) changes in the ecosystem (PHP would be a good example of that)
* When a new feature is added to the core of a language, it encourages all users to use it, even if only an influent
 minority actually needs it.

In contrast, growing the language via libraries mitigates these issues, because you have more nuanced options than 'add feature X or leave it out'.

<div class="my-tweet-wrapper">
<blockquote class="twitter-tweet" data-lang="en" data-cards="show"><p lang="en" dir="ltr">stable core with additive innovation in libraries <a href="https://twitter.com/hashtag/clojure?src=hash&amp;ref_src=twsrc%5Etfw">#clojure</a> <a href="https://t.co/dhBYdEWSRB">https://t.co/dhBYdEWSRB</a></p>&mdash; stuarthalloway (@stuarthalloway) <a href="https://twitter.com/stuarthalloway/status/949343240435720198?ref_src=twsrc%5Etfw">January 5, 2018</a></blockquote>
</div>

Having said that, you could reasonably argue that giving _every_ user the ability to extend the language gives them
 more power to shoot themselves in the foot. From what I've seen, this hasn't really be the case with Clojure so far:
 only a minority of Clojure programmers write macros, and the 'leadership' of the language has done a good job
 educating the community to the perils of macros.

Finally, this 'growing via libraries' aspect has led Clojure to be a very stable language: its users aren't really
 asking for new features. In this sense, Clojure is more mature than older, mainstream languages like JavaScript and Java,
 which keep undergoing major evolutions (most of which are welcomed, but with unforeseen consequences).

## Summary

Because Clojure's syntax is just an effective notation for data structures, it serves as a generic representation
 for structured thought. Macros can then be used to attach new _meanings_ to syntax, which relieves programmers of
 many incidental concerns, and has been an 'unfair advantage' to Clojure's ecosystem, allowing it with relatively little effort
 to achieve very good stability and tooling, while providing access to a rich set of programming paradigms.

Again, I realize these are bold claims. If you're skeptical, I would encourage you to give Clojure a try and make your own mind.

Finally, it should be noted that a lot of what was said above applies to other languages of the LISP family, not just Clojure.
