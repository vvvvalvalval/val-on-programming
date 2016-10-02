{:title "Using Datomic in your app: a practical guide"
 :layout :post
 :tags  ["Datomic" "Clojure"]
 :toc true}

*Schema rigidity, N+1 problem, impedance mismatch, remote querying, consistency...*
 Datomic eliminates many of the biggest problems of traditional databases.
 That's how I like to pick technologies: to solve the hard problems for me and leave me the easy ones.
 I have been using Datomic professionally for over 8 months now, and I can testify that it's given me a tremendous boost in productivity and quality,
 even for ordinary web development tasks.

However, because Datomic is so different from other databases, and because its young ecosystem still lacks convention,
 it's taken me some time and thought (at least a week) to come up with an architecture that is practical and lets me leverage its special powers.
 My hope is that by reading this post, you'll be able to get started more quickly.


## Required background

The code samples will be in Clojure, but most of the ideas behind them translate easily to other JVM languages.

I will not dive into the generalities of web development with Clojure; for that, I recommend the [Luminus Framework](http://www.luminusweb.net/).
 I will only focus on the aspects that are specific to Datomic.

I am assuming that you have basic notions of how Datomic works.
 If you don't, I heartedly recommend the [Day of Datomic](http://www.datomic.com/training.html) training series, as well as the [official documentation](http://docs.datomic.com/).

### A quick Datomic refresher

* In Datomic, the basic unit of information if the *datom*,
which is a 5-tuple of the form `[<entity id> <attribute> <value> <transaction id> <operation>]`, representing a fact.
 Examples of datoms are `[42 :user/email "hello@gmail.com" 201 true]` and `[42 :user/friend 42 206 false]`.
 The *transaction id* essentially tells us the time at which the fact was added to the system; the *operation* tells us
   if we learned the fact or unlearned it.
* A Datomic *database value* is an immutable, shared data structure that is logically a set of datoms.
A database value represents all the knowledge we have at a certain point in time. It's analogous to a *commit* in Git.
* Database values only grow by accumulating new datoms (there's no 'remove' operation: they do not 'forget' facts).
* A Datomic system is a succession of database values. The succession of values is controlled by a process called the Transactor.
 A Datomic *Connection* is a remote *reference* to the current database value (similar to a [Clojure Agent](http://clojure.org/reference/agents)).
 You can immediately get the current database value from a connection, and you can send writes (called [transaction requests](http://docs.datomic.com/transactions.html))
 asynchronously to the connection.
* With Datomic, reading is local, and happens on the application process (which is called a 'Peer').
 This is possible because database values are immutable, therefore easy to cache and location-transparent. As a peer queries a database value,
 it gets lazily loaded and cached into its memory, by chunks (called *segments*) so as to avoid many I/O roundtrips to storage.
* Datomic provides a low-level reading interface via its [indexes](http://docs.datomic.com/indexes.html),
  as well 2 high-level reading interfaces on top of it: the [Datalog](http://docs.datomic.com/query.html) query language and [Entities](http://docs.datomic.com/entities.html).

## Business Logic

### Represent business entities with... Entities

When I was programming with client-server databases, I often asked myself questions like:
 *Should my function accept an id for this entity? Or should it accept a map representing the entity? If so, what attributes of the entity do I need? What if I need more?* etc.
 Obviously there's a balance to be struck between flexibility and performance when
 addressing this kind of dilemma, because we're talking about a potentially costly roundtrip to the database server.

With Datomic we don't have this dilemma, because we have Entities. Entities are about as cheap to make as identifiers,
 contain as much information as the whole database, and provide a convenient map-like interface.
 So the guideline is simple: I always use Entities as the unit of information to communicate between my business logic functions.

For instance, here's a function which finds the comments of a user about a post:

```clojure
(require '[datomic.api :as d])

(defn comments-of-user-about-post
  "Given a user Entity and a post Entity, returns the user's comments about that post as a seq of Entities."
  [user post]
  (let [db (d/entity-db user)]
    (->> (d/q '[:find [?comment ...] :in $ ?user ?post :where
                [?comment :comment/post ?post]
                [?comment :comment/user ?user]]
           db (:db/id user) (:db/id post))
     (map #(d/entity db %))
     )))
```

On the whole, I implement business logic using a few categories of functions:
* functions that accept entities, and return other entities (like in the example above)
* functions that accept entities, and compute a result (e.g a boolean for making a decision, or a number synthesized from an aggregation)
* functions that accept entities, and return transaction data (for writing)

In addition, at the boundaries of my domain logic, I have functions which convert entities to and from entities, mostly:
* *finder* functions, accepting a db value and an identifier and returning an entity, e.g `(find-user-by-id db #uuid"57062d44-8829-4776-af3a-2fdf4d7ce93a")`
* *clientizer* functions, accepting an entity and returning a data structure (typically a plain old map)
which can be sent over the network (typically to the  client), serialized as JSON or Transit for example.
Here's an example of clientizer function:

```clojure
(defn cl-comment
  "clientizes a comment."
  [cmt]
  {:id (:comment/id cmt)
   :content (:comment/content cmt)
   :author {:id (-> cmt :comment/author :user/id)}
   :post {:id (-> cmt :comment/post :post/id)}})
```

Don't forget that in Datomic the database is effectively local, so you don't have the N+1 problem.
 This means you can feel free to handle a request by doing many simple queries instead of one big query. **_A query is not an expedition._**

For example, imagine you want to make a Compojure REST endpoint that fetches the comments of a user about a specific post.
Because you want to save network roundtrips to database storage, you may write it as:
```clojure
;; BAD
(GET "/posts/:postId/comments-of-user/:userId"
  [postId userId :as req]
  (let [db (:db req)]
    {:body (->>
             ;; big hairy query, which complects resources identification, domain logic, and result layout
             (d/q '[:find ?id ?content ?userId ?postId
                    :in $ ?userId ?postId :where
                    ;; resources identification
                    [?user :user/id ?userId]
                    [?post :post/id ?postId]
                    ;; domain logic
                    [?comment :comment/post ?post]
                    [?comment :comment/author ?user]
                    ;; result layout
                    [?comment :comment/id ?id]
                    [?comment :comment/content ?content]
                    ]
               db userId postId)
             (map (fn [[id content userId postId]]
                    {:id id
                     :content content
                     :author {:id userId}
                     :post {:id postId}})))}))
```
Obviously this is not great for code reuse. Well, you don't have to do that. Instead, you can compose the simple functions we have defined above and just write:
```clojure
;; GOOD
(GET "/posts/:postId/comments-of-user/:userId"
  [postId userId :as req]
  (let [db (:db req)
        ;; resources identification
        user (find-user-by-id db userId)
        post (find-post-by-id db postId)]
    {:body (->> (comments-of-user-about-post user post) ;; domain logic
             (map cl-comment) ;; result layout
             )}))
```
There are many queries involved here, but there will be very few roundtrips to storage, typically one or two, and maybe zero if the relevant segments are already cached on the Peer.

### Querying: Datalog vs Entities.

<div style="text-align:center;"><img src="/img/DATALOG-VS-ENTITIES.jpg" width="400px"></div>

Datomic gives you 2 main mechanisms for querying: Entities and Datalog queries. They're very complementary; feel free to mix and match them!
* Datalog works though pattern recognition in the database graph. It has its own constructs for control flow and abstraction, and is useful for expressing domain logic via declarative rules.
* Entities are useful for 'navigating' around in your database, using your programming language for control flow and abstraction.

Additionally, both Datalog and Entities can use the [Pull API](http://docs.datomic.com/pull.html),
 which is a declarative, data-oriented way of specifying what information about an entity you're interested in.

## Schema / model declaration

Before you can add useful data to Datomic, you need to *install your schema*, which specifies the set of attributes that represent your domain model in Datomic.

In Datomic, installing your schema consists of submitting a regular transaction. Attribute installation transactions are idempotent,
 so you can just write your schema installation transaction in your application code and `transact` in your server startup code.

Here's an example of a schema installation transaction, representing a Person entity with id, email and name fields:

```clojure
(ns myapp.model
  (:require [datomic.api :as d]))

(def schema
  [{:db/id (d/tempid :db.part/db)
    :db/ident :person/name
    :db/valueType :db.type/uuid
    :db/unique :db.unique/identity
    :db/doc "A person's unique id"
    :db/cardinality :db.cardinality/one
    :db.install/_attribute :db.part/db}
   {:db/id (d/tempid :db.part/db)
    :db/ident :person/email
    :db/valueType :db.type/string
    :db/doc "A person's email address"
    :db/fulltext true
    :db/cardinality :db.cardinality/one
    :db.install/_attribute :db.part/db}
   {:db/id (d/tempid :db.part/db)
    :db/ident :person/name
    :db/valueType :db.type/string
    :db/doc "A person's name"
    :db/fulltext true
    :db/cardinality :db.cardinality/one
    :db.install/_attribute :db.part/db}])
```

There is a [variety of opinions](http://stackoverflow.com/questions/31416378/recommended-way-to-declare-datomic-schema-in-clojure-application)
on how you should declare and install your schema, but in my view we have 2 issues here:

  * Issue 1: there's a lot of noise; ideally we'd like to spend 1 LoC on each attribute, not 7.
  * Issue 2: it's *only* useful for Datomic schema installation, whereas you may want to declare a schema for your data model for other purposes
   (input validation, documentation, REST endpoints generation, plumatic Schemas, test.check generators, etc.).
  In other words, when implementing these other aspects of your data model, you'll be to duplicating code to some extent.

There are several libraries which tackle these issues; some are just concise DSLs on top of Datomic schema transactions,
 while others take care of more things (but are also more opinionated):
  * [datomic-schema](https://github.com/Yuppiechef/datomic-schema)
  * [tupelo-datomic](https://github.com/cloojure/tupelo-datomic)
  * [spec-tacular](https://github.com/SparkFund/spec-tacular)
  * [adi](https://github.com/zcaudate/adi)

The general idea is always the same: have a DSL generate a high-level data structure representing your data model,
 then *derive* your Datomic schema installation transactions (and other things) from this data structure.

Personally, none of these libraries satisfied me completely for my use case, so I wrote up my own little DSL for dealing with Issue 1
 (it's not hard, really, you can totally get away with it).
 I've been coping with Issue 2 so far without too much trouble - it's a pain, but really not what I spend most time on.
 So really, see what works for you.

In this regard, you may be wondering:

### Where's my ORM?

*(If you're definitely not interested in ORMs, you may skip this section).*

Well, first off, you have to consider that Clojure is not Object-oriented, and that Datomic is not Relational (in the sense that data
 is not structured as relations, which is a fancy name for tables). So much for O and R.

However, this doesn't mean that you wouldn't want to perform a Mapping of some sort. One of goals of ORMs is to let you use constructs of
 your programming language. What with Entities and the Pull API, Datomic already goes a long way to facilitate that.

Another feature of ORMs is to address other issues with your data, such as validation (see 'Issue 2' above).
 Datomic doesn't provide anything to help you do that.

If that's an issue, you may even want to roll out your own mapping library.
 Implementing ORMs is knowingly difficult, but Clojure/Datomic Mapping should be significantly easier that Object/Relational Mapping,
 because many of the fundamental issues of SQL databases and Object-Oriented languages simply don't exist in these technologies:

  1. The database is immutable and not remote, which eliminates most of the thorny distributed systems / concurrency issues you would face when implementing an ORM for a client-server database.
  2. The impedance mismatch between Datomic databases and Clojure data structures is *much* smaller than the impedance mismatch between relations and objects.
  3. The DDL of Datomic is first-class data, which you can run query against and annotate as much as you want.
  4. You're not constrained by a class system for declaring schemas, so you can use the syntax and information model you want.

(Don't be too eager to go down that road though. Chances are you'll be *fine* with just Datomic)

ORMs tend to be frowned upon in the Clojure community, because existing ORM implementations are so incompatible with the idea of simplicity,
 because they encourage terrible distributed system semantics,
 and probably also because many the Java Enterprise veterans of the community had a traumatic experience with them.

However, I do believe that some of the appeal of ORMs is valid.
 Maybe what's missing in this space is a generic, extensible way to declare your schemas and derive behaviour from them,
 and I might eventually come up with a library that lets you do it à la carte. Stay tuned.


## Data Migrations

Part of database management is ensuring your database schema evolves in sync with your application code.

As we've seen, adding an attribute (the equivalent of adding a column or table is SQL) is straightforward.
 You can just reinstall your whole schema at deployment time. Same thing for [database functions](http://docs.datomic.com/database-functions.html).

Modifying an attribute (e.g changing the type of `:person/id` from `:db.type/uuid` to `:db.type/string`) is more problematic,
 and I suggest you do your best to avoid it. Try to get your schema right in the first place; experiment with it in the
 in-memory connection before committing it to durable storage. If you have committed it already, consider versioning the attribute
 (e.g `:person.v2/id`).

You probably won't ever need to delete an attribute. Just stop using it in your application code.

Finally, you will sometimes need to run a migration that does not consist of modifying the schema, but the data itself
 (fixing badly formatted data, adding a default value of a new attribute, etc.).
 You want to run these migrations exactly once at deployment time.
 The strategy for that is:
  1. write a transaction function for your migration
  2. keep track of what transaction have already been run in the database
  3. have a generic transaction function that conditionally runs another transaction only if it has not already been run
  4. at deployment time, send your migration transactions wrapped by the generic transaction function to the transactor.
  This way the transactional features of Datomic take care of the coordination for you.

Note that there's a library called [Conformity](https://github.com/rkneufeld/conformity) which takes care of 2, 3 and 4 for you.

As an example, imagine that you realize you stored all of your user's email addresses without controlling the case,
 and you want to convert them to lower case.

You will add this transaction function to your schema:

```clojure
{:db/id (d/tempid :db.part/user)
 :db/ident :myapp.fns.migrations/lowercase-user-emails
 :db/fn (d/function
          {:lang "clojure"
           :params '[db]
           :requires '([datomic.api :as d]
                       [clojure.string :as str])
           :code '(for [[user email] (d/q '[:find ?user ?email :where
                                            [?user :user/email ?email]]
                                       db)]
                    [:db/add user :user/email (str/lower-case email)])})}
```

Then the transaction that runs your migration is simply:

```clojure
[[myapp.fns.migrations/lowercase-user-emails]]
```

The generic transaction function for conditionnaly running migrations may look like the following:

```clojure
[{:db/id (d/tempid :db.part/user)
  :db/ident :run-tx-if-necessary
  :db/doc "runs the given named transaction if it has not already been run."
  :db/fn (d/function
           {:lang "clojure"
            :params '[db migr-name tx-data]
            :requires '([datomic.api :as d])
            :code '(when-not (d/q '[:find ?migr . :in $ ?name :where
                                    [?migr :migration/name ?name]]
                               db migr-name)
                     (concat
                       [[:db/add (d/tempid :db.part/user) :migration/name ?name]]
                       tx-data))})}
 {:db/id (d/tempid :db.part/db)
  :db/ident :migration/name
  :db/valueType :db.type/string
  :db/unique :db.unique/identity
  :db/doc "Support attribute for :run-tx-if-necessary"
  :db/cardinality :db.cardinality/one
  :db.install/_attribute :db.part/db}]
```

Then conditionally running the migration simply consists of transacting the following:

```clojure
[[:run-tx-if-necessary "lowercase-user-emails" [[myapp.fns.migrations/lowercase-user-emails]]]]
```

Again, if you're using Comformity, you needn't concern yourself with that.
This is just to give you an idea of how it works.

## Testing and development workflow

A significant part of the leverage you get from using Clojure and Datomic is the testing and interactive development stories.
These are not trivial to get right, so you need to plan your architecture and workflow for them. Hopefully I've done most of the work for you.

### Fixture data

If you're doing example-based testing, you're going to need some example data for your tests to work on, aka *fixture data*.

Simply have a namespace where you write your fixtures as Datomic transactions, which will be run when your create your Datomic connection
for testing or development.

You'll also want to expose some stable identifiers so that your test code can find the particular entities that interest them in the fixtures.

Example:

```clojure
(ns myapp.fixtures
  (:require [datomic.api :as d]))

(def person1-id #uuid"579ef389-525e-4017-bdd7-3eebb4a1f484")
(def person2-id #uuid"579ef39b-13af-4acd-b3c9-3fb63a42d2ef")

(def persons
  [{:person/id person1-id
    :person/email "person1@gmail.com"
    :person/name "Odysseus"
    :db/id (d/tempid :db.part/user)}
   {:person/id person2-id
    :person/email "person2@gmail.com"
    :person/name "Calliope"
    :db/id (d/tempid :db.part/user)}])

;; [...]

(defn tx-fixtures
  "Returns a transaction which installs all the fixture data."
  []
  (concat
    persons
    ;; [...]
    ))
```

### Creating in-memory connections

The next thing we need is a way to obtain an in-memory Datomic connection with all the schema and fixture data installed.

Here's an implementation, which we'll modify slightly when we learn about forking connections.

```clojure
(require '[datomic.api :as d])
(require '[myapp.schema :as mysc])
(require '[myapp.fixtures :as fix])

(defn scratch-conn
  "Creates an in-memory Datomic connection.
  NOTE: we actually won't be using this implementation, see next section on forking connections."
  []
  (let [uri (str "datomic:mem://" "mem-conn-" (d/squuid))]
    (d/create-database uri)
    (d/connect uri)))

(defn fixture-conn
  "Creates a Datomic connection with the schema and fixture data installed."
  []
  (let [conn (scratch-conn)]
    @(d/transact conn (mysc/tx-schema))
    @(d/transact conn (fix/tx-fixtures))
    conn))
```

### Forking database connections

So now we have connections that we can use for development and testing.
That's a good start, but in their current form they can be impractical:

  * if you run a test case which does writes, and want to go back to a fresh state, you'll need to explicitly
release the current connection and make a new one;
  * on my dev laptop, running `(fixture-conn)` takes about 300 ms to create the database and install the schema and fixture.
If you plan on running dozens or hundreds of tests, this can feel really slow.

Fortunately, a few months ago I discovered that you can use one of Datomic's superpowers, *speculative writes* (aka [db.with()](http://docs.datomic.com/clojure/#datomic.api/with)),
to implement an *fork* operation on Datomic connections.
I could talk at length about forking connections (and I do it [here](http://vvvvalvalval.github.io/posts/2016-01-03-architecture-datomic-branching-reality.html)); in a nutshell, forking a connection is the ability to
create a new, local connection which holds the same current database value as the old connection, but will evolve independently
of the old connection afterwards.

Forking connections solves both our problems because:
  * you don't need to do any manual resource reclamation; forked connections will just be garbage-collected when you're done with them.
  * forking is completely inexpensive in time and space (the overhead is that of creating a Clojure Atom).

This changes the way we obtain a mock connection: instead of creating a connection from scratch on each test case,
we'll create a *starting-point* connection once, and then *fork* it to obtain a fresh connection for each test case.

I've implemented a tiny library called [datomock](https://github.com/vvvvalvalval/datomock) which implements this fork operation.
It also implements the equivalent of `scratch-conn`, so our previous code becomes:

```clojure
(require '[datomic.api :as d])
(require '[datomock.core :as dm])
(require '[myapp.schema :as mysc])
(require '[myapp.fixtures :as fix])

(defn make-fixture-conn
  []
  (let [conn (dm/mock-conn)]
    @(d/transact conn (mysc/tx-schema))
    @(d/transact conn (fix/tx-fixtures))
    conn))

(def starting-point-conn (make-fixture-conn))

(defn fixture-conn
  "Creates a Datomic connection with the schema and fixture data installed."
  []
  (dm/fork-conn starting-point-conn))

```
(we'll make one more tiny change to this code in the next section. It'll be the last one, I promise!)

Forking Datomic connections has other benefits.
For instance, forking your production connection enables you to instantly reproduce the state of your production system on your local machine.
That's very handy for debugging, or if you need to make a manual modification to your data and want to "rehearse" it locally before
 committing it to the production database.

### Auto-reloading tests and fixture freshness

We still have a problem with the above code: it works fine for running your test suite once or starting a local server,
but it's not compatible with interactive development.

Whether you're running your tests in the REPL or using a auto-reloading test runner like Midje,
whenever you make changes to your schema or fixture code, starting-point-conn won't get updated automatically, and your tests
won't reflect your last code changes.

We solve this using the oldest magic trick of Computer Science: time-based caching!
Instead of storing our `starting-point-conn` in a Var, we'll cache it with a Time To Live of a few seconds.

If you're using the Google Guava library you can use their in-memory cache directly,
otherwise it's easy enough to make your own with an Atom and the core.cache library.

So finally, here's the **whole** code for creating in-memory connections:

```clojure
(require '[clojure.core.cache :as cache])
(require '[datomic.api :as d])
(require '[datomock.core :as dm])
(require '[myapp.schema :as mysc])
(require '[myapp.fixtures :as fix])

(defn make-fixture-conn
  []
  (let [conn (dm/mock-conn)]
    @(d/transact conn (mysc/tx-schema))
    @(d/transact conn (fix/tx-fixtures))
    conn))

(defonce conn-cache
  (atom (cache/ttl-cache-factory {} :ttl 5000)))

(defn starting-point-conn []
  (:conn (swap! conn-cache #(if (cache/has? % :conn)
                             (cache/hit % :conn)
                             (cache/miss % :conn (make-fixture-conn)))
           )))

(defn fixture-conn
  "Creates a Datomic connection with the schema and fixture data installed."
  []
  (dm/fork-conn (starting-point-conn)))
```

### Environments

In my day-to-day work, the environments I use are:

* 'local': in-memory Datomic instance with fixture data.
* 'dev': Datomic instance on my local machine with real-world data (typically a dump of my production instance).
* 'prod': Datomic connection of my production system
* 'dev-fork': fork of the 'dev' Datomic instance, so that I can work on real-world data without persisting anything.
* 'prod-fork': fork of my production Datomic instance, when I need to work on up-to-date data locally

In practice, the environments I use most are 'local', 'dev-fork' and 'prod-fork'.

## Misc

Here are some last tips:

* If you have ClojureScript on the client, don't forget to have a look at the [Om Next architecture](https://github.com/omcljs/om/wiki#om-next).
 It's very straightforward to implement with Datomic and the Pull API, and it can save you a lot of work and trouble compared to 
 setting up a REST architecture.
* Check out [Datascript](https://github.com/tonsky/datascript), which can make it easy to sync data between Datomic and the client.
* One technique that's often useful is *attribute sharing*: share an attribute across several entity types.
 For instance, if there are several entity types for which you want to track the creation time,
 you may want to have a generic `:time/created` attribute, instead of 2 attributes `:post/created` and `:comment/created`.
 (There are ways in which you can abuse this approach, just know that it's a possibility).
* Write your own lib! The Datomic ecosystem is still young, and Datomic is pretty uniquely extensible via libraries.
 It's completely okay to write a few helper functions to make your interactions with Datomic more convenient.
 Think of Datomic as a great *foundation* for your database needs.


## Conclusion

I hope you've found this useful, if there's anything that's unclear or missing in this post feel free to comment.
 Have fun with Datomic!