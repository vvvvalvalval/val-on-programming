{:title "Java, then Scala, then Clojure : from balloon to zeppelin to plane"
 :layout :post
 :tags  ["programming languages"]
 :toc true}
 
People interested in Scala and Clojure, looking for good insights to choose.
 
All a testimony, not a theoretical features comparison <u class="sn">I'm **not** saying we should not communicate about language features</u>.
 
## My journey through JVM languages

Again this is a testimony, so I'll start with some personal story telling.

### Javaland: ignorance is bliss

I started programming 10 years ago, when I was 14. I picked Java as my first language, because my father is an experienced Java programmer, and taught me the basics of it.
 
- used it for 7 years, unaware of an uninterested in other languages
- mostly AI and data science school projects, then web / enterprise applications
- was having a great time with it. Prided myself in knowing all the cool languages features (e.g generics), learned all the design pattern etc. Felt I was really mastering something. Felt enlightened.
- didn't imagine programming could get any better, therefore not very interested in learning other languages.

After some time, my perspective changed. I started feeling too slow. It felt like running underwater: I could see exactly each step I would take to get to my objective, but it was just too slow to get there.

So I started looking for other, 'better' languages. My familiarity with Java and its library ecosystem led me to start with JVM languages. At the time, I saw mainly 3 options: Groovy, Scala, and Clojure.

Started with Groovy and quickly discarded it, felt to brittle, inconsistent. 
Clojure looked weird, and since it had the smallest market share, I trusted the wisdom of the crowd and assumed it was not the best option.
  
### betting on Scala
  
So I looked into Scala and got very enthusiastic about it. 
It had this very nice syntax, it had all the awesome enhancements to Java (behavior in interfaces, pattern matching and case classes, singleton objects, unified type system),
it had all these additional features (implicits, functions, etc.), _and_ it allowed for both the Object Oriented and Functional paradigms, meaning it was applicable to the broadest range of problems.
    
(Pause: you see there are problems here right ?  I've underlined all the wrong reasoning.)

I did a few projects with Scala (mostly web applications) and indeed it was a big improvement over Java. 
But as I progressed in my projects, stuff started to feel wrong again. Some of Java's problems (e.g the rigidity) were still here.
Having this huge kit of language features was not really helpful, because you could combine them in a ton of different ways;
as a consequence, design decisions were hard to make, and the library ecosystem was an explosion of small, not very compatible components.

### ... and there came Clojure

Not quite satisfied with Scala, other project coming up, so decided to try Clojure. 
What convinced me to switch was not the language features, but the talks of Rich Hickey about software.
 
Was very quick to learn (about 2 weeks). Was amazed at how everything felt neat, simple, and the development environment (REPL) was just terrific. 
Looking back, felt I was at last doing 'the essence' of programming.


Not regretting anything, but realize now that my initial choice of Scala over Clojure was very poor judgement. 
I want to warn you against this pitfall.

## The Aircraft Metaphor

If you're reading this, you're problably interested in a comparison between Scala and Clojure; most likely, 
you probably don't know at least one of them, and both of them being in an early stage there is not a lot of objective historical data to compare them.

So I'll tell you a story about something that you do know from history: aircraft in the XXth century. 

<i>
When [balloons](https://en.wikipedia.org/wiki/Balloon_aeronautics) were invented in 1783, they opened a whole new world of possibilities. 
You could use them to see very far, travel over land and sea, do new physics experiments, etc.
</i>

When Java was introduced, it brought a lot of things to the programming world. 
It could run very portably on all popular operating systems, and freed programmers from the hassle of memory management, 
which enabled Java to develop a vast and reliable library ecosystem.

<i>
Of course, balloons had obvious limitations. They could only carry a very limited load, were somewhat fragile, 
and navigation was difficult, because they were very subject to atmospheric conditions (like wind, temperature, etc.).
The next step would be to use aircraft not only for exploration, but also for trade and transportation.
</i>

Over the years, the limitations of Java became more and more apparent. Compared to other languages, 
it had a heavy syntax, was not very expressive, had some inconsistencies in its type system (reference vs primitive types),
its class system was rather limited. What's more, as applications became more and more concurrent, the need grew for alternative paradigms for state and concurrency;
in particular functional programming became more and more desirable to the Java ecosystem. 

<i>
About 100 years after the invention of balloons, Count Ferdinand von Zeppelin came up with a new design for balloons.
It had a rigid frame which gave it an aerodynamic shape, engines for propulsion, and was much bigger than balloons, enabling it to carry a lot more weight. 
</i>

In 2003, Martin Oderski came up with a programming language called Scala. 
It ran on the same plaform as Java and could reuse Java libraries, but had a number of enhancements to make it more robust, flexible and productive than Java.
It had a cleaner syntax, a unified and more advanced type system, allowed for behavior in interfaces, and provided new features like pattern matching and implicits conversions,
 as well as functional programming primitives like first-class functions and immutable data structures.

<i>
- Planes coming out -

Fundamental rethinking of airplanes: you don't need to be lighter than air to fly. The ability to stay still is usually not necessary. Don't need an gas bag.
<i/>

- Clojure coming out - 
Fundamental rethinking of Clojure: don't need mutable data structures.
<i>
Zeppelins were adopted before planes for transportation. I can easily imagine what sort of skepticism a balloon or Zeppelin pilot could have expressed about planes :

* This is a toy invention. The ability to stay still when flying is indispensable for any serious aircraft.
* This may be nice for some crazy daredevil pilots, 
</i>

Scala and Clojure : difference between [innovation and invention](https://www.youtube.com/watch?v=gTAghAJcO1o)



