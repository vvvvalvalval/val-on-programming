{:title "Making a Datomic system GDPR-compliant"
 :layout :post
 :tags  ["Programming" "Datomic" "Clojure"]
 :toc true
 :date "2018-05-01"}

<div style="text-align:center;"><img src="/img/keep-calm-indirection.png" width="100%"></div>

There have been some concerns in the [Datomic](https://www.datomic.com/) community lately that the soon-to-be-enforced
 [EU General Data Protection Regulation](https://www.eugdpr.org/) would force many businesses give up on using Datomic, 
 due to its lack of practical ways of erasing data. This post describes an approach to eliminate these concerns, and how
 to implement it in practice (this may turn into a library someday). I'm happy to say that at [BandSquare](https://www.bandsquare.com/)
 we've been able to apply these ideas to our entire system in a matter of days.

**TL;DR:** For cases where [Datomic Excision](https://docs.datomic.com/on-prem/excision.html) is not a viable way to achieve GDPR-compliance,
 we avoid storing privacy-sensitive data in Datomic by storing it as values in a complementary, domain-agnostic Key/Value-store,
 while having the keys referenced from Datomic. To our surprise, we've found that this approach preserves almost all of the architectural
 advantages of Datomic, while requiring relatively little additional effort, thanks to the generic data manipulation capabilities of 
 Datomic and Clojure.

I'm also using this post as an opportunity to experiment with a new way of writing: giving exercises to the reader,
 which is something I quite appreciate in learning resources. Feedback welcome on that too.

**DISCLAIMER:** this article is not legal advice; its goal is to give you options, not to tell you what you're supposed
to do.

## Background: about the GDPR

The [General Data Protection Regulation](https://www.eugdpr.org/) (GDPR) is a data-privacy regulation which was approved
 by the EU Parliament in April 2016, and will be enforced starting from May 25, 2018. It concerns not just EU companies, 
 but also any company which holds private data of EU citizens.   

Among other things, the GDPR [mandates](https://www.eugdpr.org/key-changes.html) that companies apply the **Right to be Forgotten,**
 which implies:

1. having the ability to erase all personal data of a person upon request,
2. in many cases, erasing any personal data after a certain retention period (typically 3 to 5 years)


## Datomic Excision, and its limitations

One fundamental principle of Datomic is that information is [always only accumulated, never modified / deleted](https://www.infoq.com/presentations/Datomic-Database-Value);
 this is great for building robust information systems quickly, but is directly in conflict with GDPR's Right to be Forgotten. 

Because making exceptions to this principle is sometimes necessary, Datomic has long provided a way to erase data: 
[Excision](https://docs.datomic.com/on-prem/excision.html). However, using Excision can be very costly in performance
 and therefore operationnally constraining, as it can trigger massive rewrites of Datomic indexes. For this reason,
 the Datomic team themselves recommend that Excision should be used very infrequently.
 
This implies that Datomic Excision may not be a practical solution for all businesses, especially businesses that process 
 a lot of consumer data, and especially for use cases where personal data has a limited retention period, which means 
 that data erasure is no longer an exceptional event. 

What's more, at the time of writing, Excision is [not supported](https://docs.datomic.com/on-prem/moving-to-cloud.html#sec-4-5) 
 on [Datomic Cloud](https://docs.datomic.com/cloud/index.html).  


## Proposed solution: complementing Datomic with an erasure-aware key/value store

In cases where Excision is not a viable solution, the solution I've come up with is store to privacy-sensitive values in a complementary,
 mutable KV store, and referencing the corresponding keys from Datomic.

So instead of this:

<script src="https://gist.github.com/vvvvalvalval/27e362efa38404e211c581ca8223ede2.js"></script>

... you want this:

<script src="https://gist.github.com/vvvvalvalval/b554a00372cf2413f1e12a64ecfa253c.js"></script>

Of course, this PrivateDataStore needs an API, preferrably a simple one. At a minimum, the operations we need are:

1. Adding a value to the store,
2. Looking up a previously-stored value by its key,
3. Erasing the value at a key.

To make things more explicit, let's represent this API as a Java interface:

```java 
import java.util.UUID;

public interface PrivateDataStore<V> {
    /**
     * Adds a value to this PrivateDataStore,
     * returning the generated key.
     * @param v the value to store.
     * @return the key generated for this value, a UUID.
     */
    UUID addValue(V v);

    /**
     * Looks-up a key in this PrivateDataStore,
     * returning the (potentially) found value
     * wrapped in a LookupResult.
     * @param k the key to look up, which should have been returned by addValue().
     * @return the corresponding LookupResult.
     */
    LookupResult<V> lookupKey(UUID k);

    interface LookupResult<V>{
        LookupStatus status();
        V value();
    }

    enum LookupStatus {
        FOUND, ERASED, UNKNOWN_KEY
    }

    /**
     * Erases the value at the supplied key.
     * @param k
     */
    void eraseValue(UUID k);
}
```

What's important to notice here is that this store is completely generic: it **knows nothing about our domain** (we're not 
 migrating our user data from Datomic to a User Table; we're just migrating the values).

**Exercise 1:** write an in-memory implementation of `PrivateDataStore` in Clojure.

**Improvement:** the above interface is a bit naïve, as it is likely to suffer from the N+1 problem. To improve performance,
 you will probably want to make the reads and writes in batches (for example by bundling the inputs and outputs in lists of tuples), 
 and potentially in a non-blocking fashion (for instance by using [Manifold Deferreds](https://github.com/ztellman/manifold#deferreds)).

**Exercise 2.a:** Design a batching version of `PrivateDataStore` in Clojure. Define a Clojure protocol `BatchingPrivateDataStore` for it, 
 and write Clojure Specs for it.

**Exercise 2.b:** Write a PostgreSQL-based implementation of `BatchingPrivateDataStore`. 
 _Hint:_ JSONB is probably the easiest way to represent batches of composite inputs in PostgreSQL.


## Reclaiming power

Theoretically, this is all we need to store privacy-sensitive data; but of course, compared to a Datomic-only system, our application
 code has just lost a lot of expressive power, since there are now 2 data stores to interact with, including one which has a much 
 less expressive API than Datomic. Surprisingly, a lot of that power can be reclaimed with just a few generic helpers,
 by leveraging Clojure's generic data manipulation capabilities. 


### Writing

**Problem:** In pure Datomic, writes are [defined as plain data structures](https://docs.datomic.com/on-prem/transactions.html), 
 which is great, as they can be constructed from many independent parts, conveyed to arbitrary locations, and executed downstream.  
 We have lost this property with our `PrivateDataStore` API, which is defined in term of calling side-effectful functions.

**Solution:** We can still construct writes as pure data, by using a new data type to wrap privacy-sensitive values, e.g:

```clojure
(def tx-data
  "A trasaction which adds Sam Bagwell to our user base"
  [{:db/id "new-user"
    :user/id #uuid"cb8d5391-b6b8-451c-95f5-719257ed4e93"
    :user/email--k #privacy/private-value ["sam.bagwell@gmail.com" 0]
    :user/first-name--k #privacy/private-value ["Sam" 1]
    :user/last-name--k #privacy/private-value ["Bagwell" 2]
    :user/subscribed-at #inst "2018"}])
```

We can then use a generic function to execute such "extended" transactions:

```clojure
(privacy-helpers/transact-async private-data-store conn tx-data)
```
 
**Exercise 3.a:** define a new data type for wrapping such values. 
 Then, write a generic function `(replace-private-values private-data-store v)`, which must:

* collect wrapped values from the nested data structure `v`,
* add them to the `PrivateDataStore` (you may assume a batching interface as defined in Exercise 2.a),
* replace the wrapped values by the corresponding generated keys in `v`.

_Hint:_ use Specter's [`walker`](https://github.com/nathanmarz/specter/wiki/List-of-Navigators#walker).

**Exercise 3.b:** Using the above-defined `replace-private-values`, implement `privacy-helpers/transact-async`, which 
 must return a similar value to `datomic.api/transact-async`.

### Querying

**Problem:** we can still query Datomic with the usual APIs (Datalog, Pull API, Entity API), but we have no out-of-the-box way
 of replacing the `PrivateDataStore` keys with their values when necessary (Note: it may not be necessary very often).

#### Solution A: tagging keys 

In some cases, we can use a similar strategy as above for writes: tagging `PrivateDataStore` keys, then using a generic function
 on the query results which fetches the values and replaces the keys. This can be make easier by using a generic Datalog rule 
 to tag keys; here's an example:

```clojure
(d/q
  '[:find ?user ?id ?email-k ?last-name-k
    :in % $ [?user ...]
    :where
    [?user :user/id ?id]
    (read-private-key ?user :user/email--k ?email-k)
    (read-private-key ?user :user/last-name--k ?last-name-k)]
  ;; A generic Datalog rule for tagging PrivateDataStore values, using Clojure Tagged Literals
  '[[(read-private-key [?e ?a] ?tagged-k)
     [?e ?a ?k]
     [(clojure.core/tagged-literal 'privacy/key ?k) ?tagged-k]]]
  db
  [[:user/id #uuid"cb8d5391-b6b8-451c-95f5-719257ed4e93"]
   [:user/id #uuid"2abbd931-4cfa-47f0-abe4-ffd57c944999"]])
=> #{[100 #uuid"cb8d5391-b6b8-451c-95f5-719257ed4e93" #privacy/key #uuid"fb23991a-d7c7-4850-9735-904345325281" #privacy/key #uuid"348f0967-c2d5-45d5-8dbc-a562f75bbbd6"]
     [101 #uuid"2abbd931-4cfa-47f0-abe4-ffd57c944999" #privacy/key #uuid"60dce0c1-0258-4e20-91a2-3e0a4f20f0d8" #privacy/key #uuid"3a180f2e-f1c5-48aa-be0b-09c088ed023d"]}

(privacy-helpers/replace-tagged-keys private-data-store {:when-erased "(deleted)"} *1)
=> #{[100 #uuid"cb8d5391-b6b8-451c-95f5-719257ed4e93" "john.doe@gmail.com" "Doe"]
     [101 #uuid"2abbd931-4cfa-47f0-abe4-ffd57c944999" "(deleted)" "(deleted)"]}
``` 

**Exercise 4:** Implement the `privacy-helpers/replace-tagged-keys` function. 
 _Hint:_ use Specter's [`walker`](https://github.com/nathanmarz/specter/wiki/List-of-Navigators#walker).


#### Solution B: replacing keys at explicit paths

The above Solution A is very generic, and has the advantage of being completely decoupled from queries. 
 However, it is not always viable, because we don't always have enough control on the production of query results
 for tagging keys, for example when using the Pull API. In such cases, we will need a little more knowledge of the 
 data shape of the query results.

##### Extracting values from an Entity

First, it can be useful to have a function which extract some values from an entity into a map, for instance:

```clojure 
(def user-data 
  {:user/id #uuid"cb8d5391-b6b8-451c-95f5-719257ed4e93"
   :user/email--k #uuid"fb23991a-d7c7-4850-9735-904345325281"
   :user/first-name--k #uuid"e6f7ac4e-70a3-4427-9d5a-93488adc134a"
   :user/last-name--k #uuid"348f0967-c2d5-45d5-8dbc-a562f75bbbd6"
   :user/subscribed-at #inst"2018-04-23T15:04:10.674-00:00"})

(privacy-helpers/private-values-into-map 
  private-data-store 
  {:user/email {:from-key :user/email--k 
                :when-erased "(deleted)"}
   :user/first-name {:from-key :user/first-name--k
                     :when-erased "(deleted)"}}
  user-data)
=> {:user/email "john.doe@gmail.com"
    :user/first-name "John"}
```

##### Replacing privacy keys at arbitrary paths

**Exercise 5:** Implement the `privacy-helpers/private-values-into-map` function. It should accept a map as well as a Datomic Entity
 as an input.

The above solution can be enough for basic use cases, but falls short when dealing with nested collections, as returned 
 by the Pull API for example. In such cases, a more powerful approach is to replace `PrivateDataStore` keys at explicit paths,
 using the [Specter](https://github.com/nathanmarz/specter) library:

```clojure
(require '[com.rpl.specter :as sp])

;; raw Pull:
(d/pull
  db
  [:blog.post/id
   :blog.post/title
   {:blog.comment/_post [:blog.comment/id
                         :blog.comment/title
                         {:blog.comment/author [:user/id
                                                :user/email--k
                                                :user/subscribed-at]}]}]
  [:blog.post/id "21412312113"])
=> {:blog.post/id "21412312113"
    :blog.post/title "Why GDPR matters"
    :blog.comment/_post [{:blog.comment/id 324242423222
                          :blog.comment/title "I agree!"
                          :blog.comment/author {:user/id #uuid"cb8d5391-b6b8-451c-95f5-719257ed4e93"
                                                :user/email--k #uuid"fb23991a-d7c7-4850-9735-904345325281"
                                                :user/subscribed-at #inst"2018-04-23T15:04:10.674-00:00"}}
                         {:blog.comment/id 324242423223
                          :blog.comment/title "I disagree!"
                          :blog.comment/author {:user/id #uuid"2abbd931-4cfa-47f0-abe4-ffd57c944999"
                                                :user/email--k #uuid"60dce0c1-0258-4e20-91a2-3e0a4f20f0d8"
                                                :user/subscribed-at #inst"2017-07-07T00:00:00.000-00:00"}}]}

;; Transforming the result to replace PrivateDataStore keys:
(privacy-helpers/replace-private-entries-at-path 
  privacy-data-store
  [:blog.comment/_post sp/ALL :blog.comment/author]
  {:user/email {:from-key :user/email--k
                :when-erased "(deleted)"}}
  *1)
=> {:blog.post/id "21412312113"
    :blog.post/title "Why GDPR matters"
    :blog.comment/_post [{:blog.comment/id 324242423222
                          :blog.comment/title "I agree!"
                          :blog.comment/author {:user/id #uuid"cb8d5391-b6b8-451c-95f5-719257ed4e93"
                                                :user/email "john.doe@gmail.com"
                                                :user/subscribed-at #inst"2018-04-23T15:04:10.674-00:00"}}
                         {:blog.comment/id 324242423223
                          :blog.comment/title "I disagree!"
                          :blog.comment/author {:user/id #uuid"2abbd931-4cfa-47f0-abe4-ffd57c944999"
                                                :user/email "(deleted)"
                                                :user/subscribed-at #inst"2017-07-07T00:00:00.000-00:00"}}]}
```

**Exercise 6:** implement the `privacy-helpers/replace-private-entries-at-path` function.
 You may assume a batching API for looking up PrivateDataStore keys, as defined in Exercise 2.a.

#### Solution C: using graph data access layers

Finally, another solution for resolving privacy-sensitive values is to make it part of the data-fetching logic of a Graph API,
 e.g in a [GraphQL](https://graphql.org/) resolver or [Fulcro](http://book.fulcrologic.com/#_query_parsing) parser. In particular, a
 Graph API server can be a good alternative to Datomic Pull (for other reasons than the GDPR!). 


### Querying and transacting by value

The approach we have described so far does not cover cases when we want to query by value, for instance:

1. Find the user whose `:user/email` is `"john.doe@gmail.com"`
2. Create a user account for email `"john.doe@gmail.com"`, failing if one already exists
3. Find users in the database whose `:user/last-name` is something like `"Doe"`.

Use case `2.` is especially challenging, because it must be part of a transaction, and is therefore likely to happen in the 
 Transactor where calling our `PrivateDataStore` won't be an option.

#### Solution A: Hash-based equality and uniqueness

For the many cases where strict equality is acceptable, querying by value can be done via hashed values, which can be indexed 
 in Datomic without exposing sensitive information.

Continuing with our `:user/email` example, we can add a string-typed, indexed `:user/email--hash` attribute, which values are 
 computed e.g by securely hashing then base64-encoding the emails of the users. 
 This solves our use cases `1.` and `2.` mentioned above.

If you don't know what library to use for hashing, I recommend [buddy-core](http://funcool.github.io/buddy-core/latest/).


#### Solution B: Adding indexes to PrivateDataStore

For non-transactional reads, another strategy is to add a 'search by value' operation in our `PrivateDataStore`. 

For instance, we could modify our `PrivateDataStore` interface to the following:

```java 
import java.util.Collection;
import java.util.UUID;

public interface PrivateDataStore<V> {
    /**
     * Adds a value to this PrivateDataStore,
     * returning the generated key.
     * @param v the value to store.
     * @param indexName the name of the index referencing v,
     *                  or null if v is not to be indexed.
     * @return the key generated for this value, a UUID.
     */
    UUID addValue(V v, String indexName); // NOTE modified

    /**
     * Searches for keys matching a given value in a given index.
     * @param indexName the name of the index in which the value
     *                  was potentially added
     * @param searchV the value to search for
     * @return the (potentially empty) list of keys
     * referencing searchV in indexName.
     */
    Collection<UUID> searchByValue (String indexName, V searchV); // NOTE new operation

    // the other operations remain the same
    // [...]
}
```

You could also imagine adding options to make the search fuzzy, etc.


#### Solution C: Searching in Materialized Views

It is common practice for modern information systems to evolve so that their storage is divided into 2 categories:

- A **System of Records,** which acts as a source of truth and supports transactional writes.
- **Materialized Views,** which are data stores specialized in certain query patterns, containing data which is 
 derived from the System of Records. 

It is unusually easy to set up this sort of architecture with Datomic acting as the System of Records, 
 because the [Log API](https://docs.datomic.com/on-prem/log.html) makes it almost trivial to detect changes in the source of truth
 and update the Materialized Views accordingly.

For instance, you could use the Log API to periodically (or continuously) keep an ElasticSearch index of users documents up-to-date; 
 as privacy-sensitive fields get erased from the `PrivateDataStore`, 
 they will also get automatically erased from the ElasticSearch documents.
 You then have all the power of ElasticSearch to search customers by their privacy-sensitive fields, with the only caveat 
 that this search will only be eventually consistent with your System of Records (this is usually acceptable; note that even in Datomic,
 fulltext indexes are eventually consistent).


### Mocking and forking

**The problem:** [in my opinion](https://vvvvalvalval.github.io/posts/2016-01-03-architecture-datomic-branching-reality.html), a lot of Datomic's 
 leverage comes from its ability to do some speculative work, then discard it. This leads to the powerful notion of _forking_ 
 Datomic connections in-memory, which can for instance be applied to easily write system-level tests, and safely dry-run 
 migrations and patches to the database. We'd like to preserve the ability to fork our entire database, which is now a composite 
 of Datomic _and_ our `PrivateDataStore`.

It turns out it's fairly straightforward to write an in-memory implementation of `PrivateDataStore` which consists of forking a 
 source `PrivateDataStore`, by adding and erasing values locally, and forwarding reads to the source `PrivateDataStore`.
 You can also choose to only erase locally and add remotely; because the generated keys are UUIDs, there is no real potential for conflict;
 this can be desirable e.g for staging environments.

**Exercise 7.a:** write a `ForkedPrivateDataStore` in-memory implementation of `PrivateDataStore` which is constructed from 
an existing implementation, and use it to define a _fork_ operation on `PrivateDataStore`.

**Exercise 7.b:** write an in-memory implementation of `PrivateDataStore` based on `ForkedPrivateDataStore`. 


## Migrating an existing system

If you have an existing system with privacy-sensitive attributes, you will not only need to change the code using the 
 above-described techniques, but also perform a data migration, preferrably with no or little downtime. At the end, 
 the privacy-sensitive values must have been migrated to your `PrivateDataStore`, and erased from your Datomic system.

I recommend taking the following steps to allow for a smooth transition:

1. Install the new attributes (e.g `:user/email--k`) on your production system.
2. Deploy of new version of your code which will write to both the old **and** new attributes (e.g `:user/email` and 
 `:user/email--k`), but read **only** from the old attributes (e.g `:user/email`). Having done this, the set of datoms which 
 still have to be migrated will only ever be shrinking.
3. As an offline job, extract the datoms of the old attributes which need to be migrated 
 (example [here](https://gist.github.com/vvvvalvalval/416187b53b4f641b67f6bde7a98c6163#file-extract-privacy-sensitive-datoms-clj)),
 write their values to the `PrivateDataStore`, then gradually transact the generated keys into the new attributes (you may 
 want to use a transaction function to make sure you don't write keys for outdated values, example 
 [here](https://gist.github.com/vvvvalvalval/991cd9a62890ec93d99fc1a414c71a3e))
4. Deploy a new version of your code which now writes to **and** reads from the new attributes (e.g `:user/email--k`), 
 and no longer uses the old attributes at all (e.g `:user/email`).
5. Erase the values of the old attributes. This may not always be trivial, so see the next section for the details of how
 to do that.

Note that this approach will eventually yield a valid _**present**_ value of the database, but will not update history to add 
 the new attributes. I can imagine ways of adding the new attributes to the history, but I won't describe them here, because 
 I don't want to encourage you in this direction: as I've [said before](http://vvvvalvalval.github.io/posts/2017-07-08-Datomic-this-is-not-the-history-youre-looking-for.html),
 your application code should **not** rely on history.


### Erasing legacy attributes

[Datomic Excision](https://docs.datomic.com/on-prem/excision.html) is the preferred way to erase values from Datomic, but is 
not always a viable option:

* At the time of writing, Excision is not available on Datomic Cloud.
* Excision will not erase the fulltext indices for `:db/fulltext` attributes.
* Excision can trigger massive online index rewrites, which can have a significant performance impact and effectively make 
 you system unavailable for writes for some time.

For such cases, there is an alternative to Excision for erasing data from your system: see 
[this Gist](https://gist.github.com/vvvvalvalval/6e1888995fe1a90722818eefae49beaf).


## Experience report

To give you an idea about the context in which we applied these ideas:

* BandSquare is a SaaS platform which provides businesses with insights about their audiences and new ways to interact with them
* Both business-facing and consumer-facing
* With a broad spectrum of technical challenges, from Web / UX to Analytics and data exploration
* BandSquare's backend is a 2-years old, 35 kLoC Clojure system
* which uses (mostly) Datomic as the System of Records, and (mostly) ElasticSearch as a Materialized View
* about 35M datoms in over 400 attributes

I was pleasantly suprised by how few places privacy-sensitive attributes appeared in: mostly signup/login, some transaction emails, ETL, 
some logging and search. The vast majority of the advanced business logic simply didn't touch them.

The main leverage we have gotten since adopting Datomic (and Clojure along with that) has been ease of testing, a productive interactive workflow,
 decoupled querying, agile information modeling, ease of debugging, and last but not least the ease of setting up derived data systems.
 See [this article](https://medium.com/@val.vvalval/what-datomic-brings-to-businesses-e2238a568e1c) for a more in-depth description.
 These benefits have not significantly degraded since adopting this `PrivateDataStore` approach.

The main regression compared to the previous architecture was the loss of code/data locality in some places, which was alleviated 
 by using batching reads. [Specter](https://github.com/nathanmarz/specter) was instrumental in achieving clean, generic solutions
 to these problems, not just by bringing expressive power, but also by bringing the right abstractions.

More generally, the generic data manipulation facilities of both Clojure (via its data structures) and Datomic (via its universal, reified schema)
 were very useful for getting the migration done with a little, generic, well-tested code rather than a lot of application-specific code
 scattered all across the codebase. Namespaced keys were very helpful to refactor reliably: its a great situation to be able to 
 track all the places where a piece of information is used across the whole stack with just one text search.

The amount of code we had to add to implement these ideas in this post is about 1200 LoC: this includes PostgreSQL and in-memory
 implementations of something akin to `PrivateDataStore`, generic helpers, and about 400 LoC of tests. It did take some trial and
 error to get the abstractions right; hopefully this is a work you will not have to do having read this post.


