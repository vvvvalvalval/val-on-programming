{:title "Using PostgreSQL temporary views for expressing business logic"
 :layout :post
 :tags  ["Programming" "SQL"]
 :toc true
 :date "2017-11-05"}

I recently worked on a project which consisted of merging related data exports from a variety of sources and extracting
 accounting information from them. Because the problem was inherently very relational, I was naturally led to use an SQL
 database in the project (in this case PostgreSQL).

I ended up expressing much more of the business logic than I thought using pure SQL - more precisely, _temporary SQL Views_ -
 so I thought I'd share my findings here.

## Why SQL?

A lot of programmers think of SQL merely as a protocol for interacting with data storage, and prefer to express
 domain logic in a general-purpose language (JavaScript, Ruby, C#, ...). It's a shame, because SQL is actually very expressive!
 When applied to business logic, SQL can make for programs that are not only more concise and readable, but also more **declarative**
 (that is, programs that express only their intent, not how to achieve it) which is a very effective way of eliminating
 [accidental complexity](https://github.com/papers-we-love/papers-we-love/blob/master/design/out-of-the-tar-pit.pdf) from your code.

More concretely, I believe the advantages of SQL come from:
* relations being **more powerful data abstractions** than the ones available in general-purpose languages (arrays, structs, maps, lists, objects etc.)
* the fact that the data is centralized and _at hand_ eliminates many difficult concerns associated with moving data
 (encoding and packaging the data, validation, distributed systems issues etc.)

Modern SQL engines such as [PostgreSQL](https://www.postgresql.org/) also offer several practical benefits:

* they provide an **interactive** programming environment
* they come with an expressive, yet relatively flexible **static type system**
* they achieve quite good **performance** for the level of abstraction for which you typically use them

Finally, SQL is very **portable**. SQL is much more universally known that JavaScript / Ruby / C# / etc., which means SQL
 code is more accessible and reusable. Fun fact: this was quite useful for the data processing project I mentioned. For
 reasons inherent to the company, it had to be shipped in PHP, but since PHP makes for a poor experimental environment for
 data manipulation, I did the 'exploratory' phase of the project in Clojure then migrated it to PHP. Because most of the advanced
 logic was expressed in SQL, I was able to do the migration without too much effort, while having explored the domain with
 a fast feedback loop.

## Why SQL views?

[SQL views](https://www.postgresql.org/docs/current/static/sql-createview.html) are the primary mechanism for abstraction in SQL, playing a similar
 role to functions in procedural languages, or methods in class-based languages:

* they factor our repetition, by replacing an SQL expression with a name
* they hide implementation details: code that calls a view only knows the shape of the data, not how it is computed
* they provide a level of indirection between how data is stored and how it is queried

So SQL views are quite effective; however, the fact that they're stored durably by default brings several operational problems.
 This is where **temporary views** come in, as we'll see in the next section.

### Example: e-commerce cash flow

As an example, imagine you have to compute the cash flow of an e-commerce company. Here are the business requirements:
* The company receives money via Orders: each Order consists of several Line Items, each Line Item being a certain quantity of a Product
* The company spends money via Purchases
* The cash flow consists of the Cash Movements corresponding to Orders and Purchases

This can be expressed with the following SQL:

```sql
CREATE VIEW orders_cash_movements AS (
  SELECT
    order_id,
    order_time AS cash_movement_time,
    SUM(li_amount) AS cash_movement_amount
  FROM (
    SELECT
      o.order_id,
      o.order_time,
      (li.line_item_quantity * p.product_price) AS li_amount
    FROM orders o
    JOIN line_items li ON li.order_id = o.order_id
    JOIN products p ON li.product_id = p.product_id
  ) AS li
  GROUP BY order_id, order_time
);

CREATE VIEW purchases_cash_movements AS (
  SELECT
    purchase_id,
    purchase_time AS cash_movement_time,
    (-1 * purchase_amount) AS cash_movement_amount
  FROM purchases
);

CREATE VIEW cash_movements AS (
  SELECT cash_movement_time, cash_movement_amount FROM orders_cash_movements
  UNION ALL
  SELECT cash_movement_time, cash_movement_amount FROM purchases_cash_movements
);

```


## Why temporary views?

### Durable information, ephemeral logic

Let's go back to the basics: an _information system_ consists of:

* **information**
* **business logic** processing this information

We usually want information to be **stored durably**, because we don't want to lose any of it.

On the other hand, we typically **don't want to commit durably to our business logic**; we want to be able to change our minds
 about how our business logic handles information (because we made a bug, because business requirements changed, etc.)

This is why information systems are traditionally made of a durable database storing raw information, and processes executing
 business-logic code in an ephemeral way (usually written in languages such as JavaScript / C# / Ruby / etc.)

### The problem with stored SQL views

The problem with ordinary SQL views is that they don't have this 'ephemeral' property: if you want to change the logic of
 an SQL view, you have to make a database migration, which will affect all the database clients at the same time, making it
 difficult to manage operationally. For many applications, this operational overhead is a deal breaker for using SQL views.

### TEMPORARY views to the rescue!

This is why [**temporary** SQL views](https://www.postgresql.org/docs/current/static/sql-createview.html) are useful.
 A temporary SQL view is scoped to an SQL session, which means that both its visibility and its lifecycle will be limited
 to a single database client.

### How do you use temporary views?

You define a temporary view in SQL code by adding the TEMPORARY keyword to the CREATE VIEW command.
 Continuing with our cash flow example:

```sql
CREATE TEMPORARY VIEW orders_cash_movements AS (
  -- [...]
);

CREATE TEMPORARY VIEW purchases_cash_movements AS (
  -- [...]
);

CREATE TEMPORARY VIEW cash_movements AS (
  -- [...]
);
```

These `CREATE TEMPORARY VIEW` commands should be executed once each time a database connection is created.
 Modern SQL connection pooling libraries can be configured to execute an SQL statement each time a connection is created;
 for instance, for the [HikariCP](https://github.com/brettwooldridge/HikariCP) library,
 this is the done via the `connectionInitSql` option.

### Caching without Materialized Views

A popular strategy for caching with PostgreSQL is to use [Materialized Views](https://www.postgresql.org/docs/current/static/rules-materializedviews.html).
 For instance, we could use a Materialized View to cache our cash flow computation example:

```sql
-- WON'T WORK

-- defining the materialized view
CREATE MATERIALIZED VIEW cash_flow_cache_v0 AS (
  SELECT * FROM cash_movements;
);

-- [...]

-- refreshing the materialized view
REFRESH MATERIALIZED VIEW cash_flow_cache_v0;
```

This won't work, because a PostgreSQL Materialized View is a durable object, whereas a Temporary View is a temporary object;
 therefore, a Materialized View cannot depend on a Temporary View.

One way to circumvent this limitation is to define only the schema for the cache table, and let the client refresh the caching
 table with a plain old query:

```sql
-- defining the cache table
CREATE TABLE cash_flow_cache_v0 (
  cash_movement_time TIMESTAMP,
  cash_movement_amount INTEGER
);

-- [...]

-- refreshing the cache table
-- (preferrable to do this in a transaction)

TRUNCATE TABLE cash_flow_cache_v0;
INSERT INTO cash_flow_cache_v0 (cash_movement_time, cash_movement_amount)
  SELECT cash_movement_time, cash_movement_amount FROM cash_movements;
```

This has the advantage of minimizing the amount of business logic that we need to put in our stored caching code.

## What's missing: 'parameterized' temporary views

One thing I've found to be lacking in SQL is the ability to define views that are parameterized with other values -
 in particular, parameterized with other relations.

For instance, going back to our cash flow example, imagine we want to compute the following aggregations:

* revenue per day
* expenses per day
* total cash flow per day


```
CREATE TEMPORARY VIEW revenue_per_day AS (
  SELECT day, SUM(cash_movement_amount) AS amount
  FROM (
    SELECT
      date_trunc(cash_movement_time, 'day') AS day,
      cash_movement_amount
    FROM cash_movements
    WHERE cash_movement_amount > 0
  ) AS x
  GROUP BY day
);

CREATE TEMPORARY VIEW expenses_per_day AS (
  SELECT day, SUM(cash_movement_amount) AS amount
  FROM (
    SELECT
      date_trunc(cash_movement_time, 'day') AS day,
      cash_movement_amount
    FROM cash_movements
    WHERE cash_movement_amount < 0
  ) AS x
  GROUP BY day
);

CREATE TEMPORARY VIEW cash_flow_per_day AS (
  SELECT day, SUM(cash_movement_amount) AS amount
  FROM (
    SELECT
      date_trunc(cash_movement_time, 'day') AS day,
      cash_movement_amount
    FROM cash_movements
  ) AS x
  GROUP BY day
);
```

That's a lot of code duplication! I wish I could do something like the following instead:

```sql
CREATE TEMPORARY VIEW aggregate_cash_flow_by_day (cash_movmts) -- mind the parameter here
AS (
  SELECT day, SUM(cash_movement_amount) AS amount
  FROM (
    SELECT
      date_trunc(cash_movement_time, 'day') AS day,
      cash_movement_amount
    FROM cash_movmts
  ) AS x
  GROUP BY day
);

CREATE TEMPORARY VIEW revenue_per_day AS (
  SELECT * FROM aggregate_cash_flow_by_day(
    SELECT * FROM cash_movements
    WHERE cash_movement_amount > 0
  )
);

CREATE TEMPORARY VIEW expenses_per_day AS (
  SELECT * FROM aggregate_cash_flow_by_day(
    SELECT * FROM cash_movements
    WHERE cash_movement_amount < 0
  )
);

CREATE TEMPORARY VIEW cash_flow_per_day AS (
  SELECT * FROM aggregate_cash_flow_by_day(
    SELECT * FROM cash_movements
  )
);
```

Going back to our SQL views / functions / methods analogy: in their current form, SQL views give us the equivalent of
 0-arguments functions, or static methods. I wish we could have the equivalent of functions with arbitrary arity!
 This would give us much more leverage for code reuse and decoupling.

Note that stored procedures can't really help us achieve this, as they are not temporary. The best way to emulate them currently
 is probably to use a client SQL-generating library.


## Summary

I have found that:

* SQL is very powerful for expressing domain logic: consider using it for other purposes than just shipping data to/from storage!
* SQL views are useful for code reuse and abstraction, but because they store business logic globally and durably, they create operational difficulties
* PostgreSQL TEMPORARY views eliminate most of these operational difficulties
* If SQL views could be parameterized, they would get insanely more powerful.

Please feel free to challenge these assertions in comments!