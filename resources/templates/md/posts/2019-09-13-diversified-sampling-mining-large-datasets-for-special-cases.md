{:title "'Diversified Sampling': mining large datasets for special cases"
 :layout :post
 :tags  ["Data Engineering" "Programming"]
 :toc true
 :date "2019-09-13"}
 
In this article, I want to share a little _data engineering_ trick that I've used for building programs that consume poorly-understood data, which I'm calling 'Diversified Sampling'. This terminology is totally made up by me, and there's a high chance that this technique already exists with another name, or that the scholars have deemed it too trivial to name it at all. Hopefully some people more knowledgeable than me will comment on this.

**TL;DR:** the objective is to build a small sample of the data in which special cases are likely to be represented. The strategy is to have each data item emit a list of 'features', and to boost the probability of selecting rare features. A shallow understanding of the data is often enough to design an effective features extraction.   
 
## The problem

Suppose that you're given a large datasets of documents, and you have to build a system that extracts information from these documents. You only have a poor technical understanding of these documents: basically, some told you informally what the documents are about, and if you're lucky you have a vague spec or schema which will be mostly respected by the documents. What's more, the dataset is big enough that it would take hours for a machine to process it fully, and many lifetimes for you to read all the documents with your own eyes. Yet you have to write a program that processes these documents reliably. What do you do?

As an case study for this article, we're going to use the Articles data dump [of the Directory of Open Access Journals](https://doaj.org/public-data-dump) (DOAJ), which contains metadata about around 4 million academic articles in the form of JSON documents. To make things concrete, here's one document from this dataset:

```json
{
  "last_updated" : "2019-02-21T17:05:46Z",
  "id" : "cfc9b25374b6400da55a35d2815cc915",
  "bibjson" : {
    "abstract" : "The author estimates both medical insurance agencies’ performance in the field of providing and protecting the rights of insured persons within compulsory medical insurance and the role of insurance medical agencies in the system of social protection of citizens",
    "month" : "4",
    "journal" : {
      "publisher" : "Omsk Law Academy",
      "license" : [ {
        "url" : "http://en.vestnik.omua.ru/content/open-access-policy",
        "open_access" : true,
        "type" : "CC BY",
        "title" : "CC BY"
      } ],
      "language" : [ "RU" ],
      "title" : "Vestnik Omskoj Ûridičeskoj Akademii",
      "country" : "RU",
      "number" : "27",
      "issns" : [ "2306-1340", "2410-8812" ]
    },
    "keywords" : [ "Compulsory medical insurance", "insurance medical agencies", "free medical aid", "social protection of citizens" ],
    "title" : "The Role of Medical Insurance Agencies in the System of Social Protection of Citizens",
    "author" : [ {
      "affiliation" : "Omsk Law Academy",
      "name" : "Beketova A. V. "
    } ],
    "year" : "2015",
    "link" : [ {
      "url" : "http://vestnik.omua.ru/?q=content/rol-strahovyh-medicinskih-organizaciy-v-sisteme-socialnoy-zashchity-naseleniya",
      "type" : "fulltext"
    } ],
    "start_page" : "52",
    "identifier" : [ {
      "type" : "pissn",
      "id" : "2306-1340"
    }, {
      "type" : "eissn",
      "id" : "2410-8812"
    } ],
    "end_page" : "55",
    "subject" : [ {
      "scheme" : "LCC",
      "term" : "Law",
      "code" : "K"
    } ]
  },
  "created_date" : "2018-02-19T06:45:24Z"
}
```


## Why we need small samples

Because the dataset is so big, the need quickly arises to work on small samples of the documents, for several uses:

1. For **'having a look'** at the data, e.g getting familiar with the schema of the documents to understand what attributes are available and what they mean.
2. For **example-based testing**: you'll likely want to test whatever code you write for extracting information from the data, so a sample can give you a set of realistic examples on which you can test your processing code quickly.
3. Even if you prefer **generative testing**, you're going to have to develop a model of the data, and to iterate on that model you'll want to validate it rapidly against real-world examples.
4. On a related topic, for **data validation**: your program will make assumptions about the properties of the data, and you'll want to check that new documents fall within these assumptions. A small sample can help you iterate on these assumptions rapidly, after which you can gain even more confidence by testing these assumptions against the entire dataset.


## Naive approach: uniform sampling

The most intuitive approach to sampling is simply to select each document randomly with uniform probability; for example, to build a sample of about 1000 documents out of the 4.2 million documents of the DOAJ dataset, I could run them through an algorithm that keeps each document with probability 1000 / 4200000. 

Unfortunately, this is likely to be insufficient, because it will fail to capture some rare pathological cases that need to be handled nonetheless. Here are a few examples of 'pathological cases':

1. a few documents may be lacking an `id` attribute.
2. a few documents may have their `start_page` attribute written in roman numerals (true story!)
3. a few documents may have more than a thousand `keywords`, and your processing code will choke on that.

When you build on uniform samples, it's common to write code that seems to work perfectly fine, and then fails a few hours into processing because of one pathological input. As your information-extracting code evolves, it's important to be able to detect these edge cases rapidly.

For testing purposes, it's better to have samples in which the special cases are over-represented. We don't want to select all documents with equal probability: we want the _freaks_! But how do you select for pathological cases, since your problem is precisely that you have an incomplete understanding of how the data might behave?


## The algorithm: selecting rare features

The idea behind the approach I'm proposing here is that you can usually detect special cases even without a good understanding of the data semantics, based on some 'mechanical' aspects of the data, such as the set of attributes present in a document, or the presence of rare characters.
 
More precisely, the idea is that you would implement a function that extracts from any given document a set of 'features' (a list of Strings); the guiding principle for designing the features function is that pathological cases should exhibit rare features. For example, the features extracted from the above example might be:

```
bibjson
bibjson.abstract
bibjson.author
bibjson.author.[].affiliation
bibjson.author.[].name
bibjson.end_page
bibjson.identifier
bibjson.identifier.[].id
bibjson.identifier.[].type
bibjson.journal
bibjson.journal.country
bibjson.journal.issns
bibjson.journal.issns.0
bibjson.journal.issns.1
bibjson.journal.language
bibjson.journal.license
bibjson.journal.license.[].open_access
bibjson.journal.license.[].title
bibjson.journal.license.[].type
bibjson.journal.license.[].url
bibjson.journal.number
bibjson.journal.publisher
bibjson.journal.title
bibjson.keywords
bibjson.link
bibjson.link.[].type
bibjson.link.[].url
bibjson.month
bibjson.start_page
bibjson.subject
bibjson.subject.[].code
bibjson.subject.[].scheme
bibjson.subject.[].term
bibjson.title
bibjson.year
created_date
doaj.article.link-type/fulltext
doaj.article.n-keywords/highest1bit=4
doaj.article.n-languages/highest1bit=1
doaj.article.n-licenses/highest1bit=1
doaj.article.n-subjects/highest1bit=1
doaj.article.subject-scheme/LCC
doaj.identifier-type/eissn
doaj.identifier-type/pissn
id
last_updated
```

Notice how most of these 'features' can be derived very mechanically from the data:

* **present attributes / paths:** for example, `bibjson.author.[].name` tells you that the document is a map with a `bibjson` key, containing a map with an `author` key, containing an array of maps with a `name` key. Such a feature can be extracted from any JSON document without any more knowledge of what it contains.
* **cardinality:** for example, `doaj.article.n-keywords/highest1bit=4` tells you that the article has between 4 and 7 `keywords`.
* **enumerations:** for example, `doaj.article.subject-scheme/LCC` tells you that the article has a subject of scheme `LCC`, whatever that means. You don't need to know what a subject or a scheme is to make this extraction: you only need to 'smell' that we're dealing with an enumerated attribute.
* other good candidates include character ranges (for detecting diacritics / XML markup / encoding errors), rounded String lengths, URL or date patterns, JSON value types, etc. 

Once you can extract appropriate features, the algorithm is simple to describe: **each document is selected with a probability proportional to the rarity (inverse frequency) of its rarest feature.** More precisely:

1. You parameterize your algorithm with a small number `K` (e.g 10), meaning that every feature should on average be represented at least `K` times.
2. For each article, you draw a random number `r` between 0 and 1. If the document has a feature such that `r < K/M`, where `M` is the number of times that the feature appears in the entire dataset, then it is selected. In particular, if a feature is rare to the point of being represented fewer than `K` times, then the documents having it are guaranteed to be selected.

Some notes:

1. A generally useful refinement from the above is to consider the _absence_  of a feature as a feature itself (for instance, this is how you would select the rare occurrence of an `id` field missing). With the above notation, this implies comparing `r` to either `K/M` or `K/(N-M)` depending on whether the feature is present or not in the document, where `N` denotes the total number of articles.
2. The algorithm does 2 linear passes on the entire data, and is well suited to be run in a parallel and distributed architecture like MapReduce / Spark / etc. while accumulating very small result. Provided that your features function is not too expensive, this can run very fast.
3. You choose `K` based on the desired sample size. In practice, it can be hard to predict what the resulting sample size will be, because it depends on the number of features but also on how they correlate.

In light of this, let's have a look at the distribution of features in our dataset:

```
|                                 Feature | #articles |
|-----------------------------------------+-----------|
|                                   admin |   1262315 |
|                              admin.seal |   1262315 |
|                                 bibjson |   3925522 |
|                        bibjson.abstract |   3528943 |
|                          bibjson.author |   3892589 |
|           bibjson.author.[].affiliation |   2075706 |
|                  bibjson.author.[].name |   3885804 |
|                        bibjson.end_page |   2551540 |
|                      bibjson.identifier |   3925522 |
|                bibjson.identifier.[].id |   3925522 |
|              bibjson.identifier.[].type |   3925522 |
|                         bibjson.journal |   3925522 |
|                 bibjson.journal.country |   3925522 |
|                   bibjson.journal.issns |   3925522 |
|                 bibjson.journal.issns.0 |   3925522 |
|                 bibjson.journal.issns.1 |   2105552 |
|                bibjson.journal.language |   3925522 |
|                 bibjson.journal.license |   3925522 |
|  bibjson.journal.license.[].open_access |   3909861 |
|        bibjson.journal.license.[].title |   3922195 |
|         bibjson.journal.license.[].type |   3922195 |
|          bibjson.journal.license.[].url |   3918950 |
|                  bibjson.journal.number |   3389896 |
|               bibjson.journal.publisher |   3925522 |
|                   bibjson.journal.title |   3925522 |
|                  bibjson.journal.volume |   3800165 |
|                        bibjson.keywords |   2340697 |
|                            bibjson.link |   3925522 |
|            bibjson.link.[].content_type |   2068285 |
|                    bibjson.link.[].type |   3912438 |
|                     bibjson.link.[].url |   3912438 |
|                           bibjson.month |   3237064 |
|                      bibjson.start_page |   3167003 |
|                         bibjson.subject |   3925522 |
|                 bibjson.subject.[].code |   3918612 |
|               bibjson.subject.[].scheme |   3918612 |
|                 bibjson.subject.[].term |   3918612 |
|                           bibjson.title |   3922426 |
|                            bibjson.year |   3855525 |
|                            created_date |   3925522 |
|         doaj.article.link-type/fulltext |   3912438 |
|   doaj.article.n-keywords/highest1bit=0 |   1584825 |
|   doaj.article.n-keywords/highest1bit=1 |    200419 |
| doaj.article.n-keywords/highest1bit=128 |        47 |
|  doaj.article.n-keywords/highest1bit=16 |      8776 |
|   doaj.article.n-keywords/highest1bit=2 |    446826 |
| doaj.article.n-keywords/highest1bit=256 |         2 |
|  doaj.article.n-keywords/highest1bit=32 |       606 |
|   doaj.article.n-keywords/highest1bit=4 |   1466157 |
|  doaj.article.n-keywords/highest1bit=64 |       218 |
|   doaj.article.n-keywords/highest1bit=8 |    217646 |
|  doaj.article.n-languages/highest1bit=0 |         1 |
|  doaj.article.n-languages/highest1bit=1 |   2726455 |
|  doaj.article.n-languages/highest1bit=2 |   1058128 |
|  doaj.article.n-languages/highest1bit=4 |    137890 |
|  doaj.article.n-languages/highest1bit=8 |      3048 |
|   doaj.article.n-licenses/highest1bit=0 |      3327 |
|   doaj.article.n-licenses/highest1bit=1 |   3922195 |
|   doaj.article.n-subjects/highest1bit=0 |      6910 |
|   doaj.article.n-subjects/highest1bit=1 |   2405221 |
|   doaj.article.n-subjects/highest1bit=2 |   1459074 |
|   doaj.article.n-subjects/highest1bit=4 |     53447 |
|   doaj.article.n-subjects/highest1bit=8 |       870 |
|        doaj.article.subject-scheme/DOAJ |      4633 |
|         doaj.article.subject-scheme/LCC |   3918612 |
|                doaj.identifier-type/DOI |     47595 |
|                doaj.identifier-type/doi |   2724699 |
|              doaj.identifier-type/eissn |   2974967 |
|               doaj.identifier-type/issn |      1626 |
|              doaj.identifier-type/pissn |   2831153 |
|          doaj.identifier-type/publisher |      1150 |
|                                      id |   3925522 |
|                            last_updated |   3925522 |
```

Looking at this, we see that there are some irregularities which we could have easily missed with naive sampling:

1. One article has zero languages - this could easily have caused an error in our processing.
2. 4633 (out of 4 million!) articles have a DOAJ-specific subject scheme, instead of the almost ubiquitous LCC. 
3. 1626 articles have an ISSN number which is classified neither as electronic (`eissn`) nor print (`pissn`)
4. We see an inconsistency in how DOI identifiers are declared - most of the time as `"doi"`, and more rarely (47595) as `"DOI"`.
5. 49 articles have more than 128 keywords. This could cause performance issues, should we do some processing that emits tuples of these keywords. 

This isn't to bash on DOAJ - in my experience, compared to other academic publishers, their data exports are really a pleasure to work with. But it is a good reminder that real-world data tends to be full of surprises.

How much does Diversified Sampling increase our odds of selecting these special cases? Let's examine the example of the 4633 articles having a DOAJ-specific subject scheme:

* **Naive sampling:** if you use the naive sampling method, aiming for a sample size of 1000 articles, you have a **30.5%** chance of missing out on all 4633 articles.
* **Diversified sampling:** using diversified sampling with `K=20` (which in this case yields a sample of about 500 articles), the odds of missing out on all 4633 are _at most_ **0.0000002%**. There's a mathematical approximation that sheds some light on this: even when `K << M`, then `(1- K/M)^M ≈ exp(-K) ≈ (0.37)^K`.

## Pitfalls

### Beware of features explosion

If your features function generates too many features, then your sample size will tend to explode, and the pathological cases you were mining for will be diluted in falsely special documents. For example, in our DOAJ example, the exact number of keywords or the length of the abstract would be bad features, because these will tend to take very dispersed values that will be interpreted as rare features; when dealing with cardinalities like this, it's better to use logarithmic buckets instead of exact values.

### Design your features function well

More generally, the entire principle of this sampling algorithm relies on emitting features that correspond well to special cases. There's no one-size-fits-all solution for this: you will have to look at the data and make ad hoc guesses.

### Do not use Diversified Sampling for statistics

Do not use the diversified sample to compute aggregates like the average number of keywords. By design, Diversified Sampling selects mostly outliers which are not representative of the trends in your data. Naive samples are better for this.