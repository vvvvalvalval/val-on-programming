{:title "A bottom-up approach to state in Reagent"
 :layout :post
 :tags  ["Reagent" "Clojure" "Architecture"]
 :toc true}

In this post, I'll present an alternative way of managing state in Reagent applications to what is currently made popular by libraries like [Re-frame](https://github.com/Day8/re-frame).

## TL;DR

We'll be able to declare 'local state' inside our Reagent components, which feels like ephemeral local atoms but is accessible globally and is Figwheel-reloadable.

**End result** :
<iframe src="https://player.vimeo.com/video/139510973" width="100%" height="330" frameborder="0" webkitallowfullscreen mozallowfullscreen allowfullscreen></iframe>

(watch it in HD <a href="https://vimeo.com/139510973" target="_blank">here</a>)

## Rationale

From what I have seen, the currently most popular approach to state management in Reagent applications is to have one global Reactive Atom and to centralize the behaviour for updating this Ratom.

I completely agree that this approach is very sound for a large space of applications; it also has the advantage of making your code [Figwheel-reloadable](https://github.com/bhauman/lein-figwheel#writing-reloadable-code) out of the box.

However, I do believe this approach has its limitations. Basing everything on a global ratom encourages your components to leverage a lot of context, making them less 'portable'.
More importantly, I find this forces you to have a top-down approach to state management: you need to design the whole schema for your app state, and account for everything that could happen to it from the very start.

Sometimes, I feel I do not want this. Instead, I want my components to behave not as partial views of some global state, but as 'micro-applications', managing their own state instead of deferring this to some global decision maker.
I like the idea that my components are autonomous, and can just be plugged into their parents without much knowledge of their context. This is what I call a *bottom-up* approach to state management.
<span class="sn">This is about the only way of doing things in libraries like AngularJS, in which directives just have local state and are meant to be autonomous. What I find great in Reagent is that I can combine both approaches.</span>

In this post, I'll present a way of achieving this, while retaining some of the great benefits of the top-down approach.

## Requirements

Our goal is to abide by the following requirements :

1. We want to make Reagent components with local state. In particular, the lifecycle of this local state is bound to the lifecycle of the component: it gets initialized when the component mounts, it gets cleaned up when the component unmounts.
2. We want this local state managed by the component, not externally
3. This 'local state' is actually perceptible from the global Reactive Atom of our app. This way, our system has the 'all state in one place' property, a.k.a 'email me your state and I'll see exactly what you see'.
4. This local state is <em>reloadable</em>, i.e when we are developing with Figwheel, we don't have to re-create this state each time we make a code change.

## The traditional approach to local-state in Reagent

As we can learn from the [project page](https://reagent-project.github.io/), the traditional way of making components with local state is as follows:

* instead of writing a rendering function, you write a 'wrapper' function which *returns* a rendering function.
* the 'wrapper' function initializes some local state in the form of ratoms stored in locals of the wrapper function
* the rendering function just closes over these locals and uses them.

This is all very neat and intuitive, but it does not quite comply to our requirements : it's not reachable from our global state ratom, and it's not figwheel-reloadable.

## Strategy

Here is how we'll implement this :

* we still have a unique global ratom, which will hold *all the state* of the application (including component-local state)
* instead of creating local ratoms, stateful components will be handed a 'location' (a Cursor) in the global state where to put their local state.
* they will initialize this local state when they mount, and clean it when they unmount
* we'll also need some tricks to make this robust to figwheel code reloads.

## Example

I'll demonstrate this with a very poor, ugly version of TODO MVC.

Let's first lay out the 'model' of our app:

```clojure
(require '[reagent.core :as r])

;; this atom holds the global state, we use `defonce` to make it reloadable
(defonce todo-state-atom (r/atom {:todos []}))

;; here's a little helper to generate unique ids
(defonce next-id (atom 0))
(defn gen-id [] (swap! next-id inc))

;; these 3 functions are for manipulating the state
(defn add-todo [todo-state] (update todo-state :todos conj {:id (gen-id) :text ""}))

(defn delete-todo [todo-state {:keys [id]}]
  (update todo-state :todos (fn [todos] (->> todos (remove #(= (:id %) id)) vec))))

(defn update-todo [todo-state {:keys [id] :as todo}]
  (update todo-state :todos (fn [todos] (->> todos (map #(if (= (:id %) id) todo %)) vec))))

```

Now, let's see how to implement the view.

### The traditional way: with old fashioned locals

As a reference for comparison, we'll start by implementing it the 'traditional' Reagent way : with local ratoms to hold the local state.

```clojure
;; ... and here's our UI :
(declare <todos-list> <todo-item>)

(defn <todos-list> []
  (let [update-me! #(swap! todo-state-atom update-todo %)
        delete-me! #(swap! todo-state-atom delete-todo %)]
    [:div.container
     [:h2 "TODO"]
     [:ul
      (for [todo (:todos @todo-state-atom)]
        ^{:key (:id todo)} [<todo-item> todo update-me! delete-me!]
        )]
     [:button.btn.btn-success {:on-click #(swap! todo-state-atom add-todo)} "Add"]

     [:div
      [:h2 "State"]
      [:pre (with-out-str (pprint/pprint @todo-state-atom))]]]))

(defn <todo-item> [{:keys [id]} update-me! delete-me!]
  (let [local-state (r/atom {:editing false})]
    (fn [{:keys [id text] :as todo} update-me! delete-me!]
      (if (:editing @local-state)
        [:li
         [:span "type in some awesome text :"]
         [:input {:type "text" :value text :on-change #(update-me! (assoc todo :text (-> % .-target .-value)))}]
         [:button {:on-click #(swap! local-state assoc :editing false)} "Done"]]
        [:li
         [:span "text: " text]
         [:button {:on-click #(swap! local-state assoc :editing true)} "Edit"]
         [:button {:on-click #(delete-me! todo)} "Remove"]])
      )))
```

This is the most straightforward way of doing things, but as we said earlier, it does not yield an optimal result:
the local state is not reachable from the global atom, not does it survive code reloads. Let's make this better.

### The new way: with managed cursors

We'll store the local state in cursors of the global ratom, instead of ratoms stored in locals.

Of course, now that we're not using locals, we can no longer rely on garbage collection to clean up after us, so we have to do it explicitly using lifecycle methods.

```clojure
;; in this cursor, we'll put the local state of each list item
(defonce todos-state-cursor (r/cursor todo-state-atom [:todo-state]))

(declare <todos-list> <todo-item> <todo-item-plugged>)

(defn <todos-list> []
  (let [update-me! #(swap! todo-state-atom update-todo %)
        delete-me! #(swap! todo-state-atom delete-todo %)]
    [:div.container
     [:h2 "TODO"]
     [:ul
      (for [todo (:todos @todo-state-atom)]
        ^{:key (:id todo)} [<todo-item> todos-state-cursor todo update-me! delete-me!]
        )]
     [:button.btn.btn-success {:on-click #(swap! todo-state-atom add-todo)} "Add"]

     [:div
      [:h2 "State"]
      [:pre (with-out-str (pprint/pprint @todo-state-atom))]]]))

(defn <todo-item> [parent-atom {:keys [id]} update-me! delete-me!]
  (let [local-state-cursor (r/cursor parent-atom [id])]
    (r/create-class
      {:component-will-mount (fn [_] (when-not @local-state-cursor ;; setting up
                                       (reset! local-state-cursor {:editing false})))
       :component-will-unmount (fn [_] (swap! parent-atom dissoc id)) ;; cleaning up
       :reagent-render
       (fn [parent-atom {:keys [id text] :as todo} update-me! delete-me!]
         (if (:editing @local-state-cursor)
           [:li
            [:span "type in some awesome text :"]
            [:input {:type "text" :value text :on-change #(update-me! (assoc todo :text (-> % .-target .-value)))}]
            [:button {:on-click #(swap! local-state-cursor assoc :editing false)} "Done"]]
           [:li
            [:span "text: " text]
            [:button {:on-click #(swap! local-state-cursor assoc :editing true)} "Edit"]
            [:button {:on-click #(delete-me! todo)} "Remove"]])
         )})))
```

We have now full visibility of the whole state of our app, and can manipulate all of it using the REPL.
This is a big improvement.

However, we haven't achieved reloadability yet. Let's see how it goes.

### Making it reloadable

This is kind of tricky.

In order to reload the code, our app has to be re-mounted into the DOM on each code reload.
I'm using the [figwheel Leiningen template](https://github.com/bhauman/figwheel-template), which does it by calling a `mount-root` function on each reload :

```clojure
(defn mount-root []
  (r/render [<todos-list>] (.getElementById js/document "app")))
```

The problem is, each time a new version gets mounted, the old version gets unmounted.
As a consequence, the `:component-will-unmount` function we defined above is called, and diligently erases our local state.

We need to find a way of informing our component that the unmounting is caused by a Figwheel reload, so that it does not erase its state.
This is made harder by the fact that mounting happens asynchronously.

The best way I've found is to set up a flag when the reloading happens, and leave it up long enough that the DOM can mount :

```clojure
(defonce reloading-state (atom false)) ;; note that we're using a regular atom: the whole point is not to interfere with Reagent here.

(defn reload! [timeout]
  (when timeout
    (reset! reloading-state true)
    (js/setTimeout #(reset! reloading-state false) timeout)))

(defn reloading? [] @reloading-state)

;; ...

(defn mount-root []
  (reload! 200)
  (r/render [<todos-list>] (.getElementById js/document "app")))
```

Now we can use this by making a tiny change to our component definition :

```clojure
(defn <todo-item> [parent-atom {:keys [id]} update-me! delete-me!]
       ;; ...
       :component-will-unmount (fn [_] (when-not (reloading?)
                                         (swap! parent-atom dissoc id)))
        ;; ...
       )
```

To be honest, I'm not very proud of it, but it works;
and given that it only affects our development environment, I don't feel too worried using this little hack.


### Making it less tedious: pluggable components

This is great, but it's a pity that we have to resort to lifecycle methods and explicit calls to our `(reloading?)` hack every time we want a component with local state, especially since we're using Reagent, which usually excels as hiding away this sort of things.

Fortunately, we can make it more practical. A few weeks ago, I experimented with the concept of so-called (by me) [*pluggable components*](https://github.com/vvvvalvalval/reagent-pluggable-components-poc),
 which are a way of writing stateful components which have a cleanup phase without writing the same 'lifecyle methods recipes' over and over again.

I won't detail how it works here (although there's [not much](https://github.com/vvvvalvalval/reagent-pluggable-components-poc/blob/master/src/cljs/reagent_plug/core.cljs#L13) to it),
but basically here's the amount of work it takes :

We first define a 'managed cursor' recipe, which encapsulates the 'local cursor lifecycle' logic we coded above :

```clojure
(defmethod make-plug ::r/managed-cursor [[_] [parent-ratom key]]
  (let [curs (r/cursor parent-ratom [key])]
    (->Plug curs #(do nil) #(when-not (reloading?) (swap! parent-ratom dissoc key)))))
```

From now on, we'll be able to reuse this recipe for any stateful component. Let's see how that goes for `<todo-item>` :

```clojure
(defn <todos-list> []
      ;; ...
      (for [todo (:todos @todo-state-atom)]
        ;; the external API for the component is a tiny bit different
        ^{:key (:id todo)} [<todo-item> [todos-state-cursor (:id todo)] todo update-me! delete-me!]
        )]
      ;; ...
     )


(defplugged <todo-item>
  [(local-state-cursor [::r/managed-cursor]) ;; `local-state-cursor` gets injected into our component, and will be cleaned up once unmounted
   {:keys [id]} update-me! delete-me!]
  (when-not @local-state-cursor
    (reset! local-state-cursor {:editing false}))
  (fn [_ {:keys [id text] :as todo} update-me! delete-me!]
    (if (:editing @local-state-cursor)
      [:li
       [:span "type in some text : "]
       [:input.form-control {:type "text" :value text :style {:width "100px" :display "inline-block"}
                             :on-change #(update-me! (assoc todo :text (-> % .-target .-value)))}]
       " "
       [:button.btn.btn-success {:on-click #(swap! local-state-cursor assoc :editing false)} "Done"]]
      [:li
       [:span "text: " text " "]
       [:button.btn.btn-primary {:on-click #(swap! local-state-cursor assoc :editing true)} "Edit"] " "
       [:button.btn.btn-danger {:on-click #(delete-me! todo)} "Remove"]])
    ))
```

It's now as lightweight as we'd expect of Reagent!

## Wrapping up

I'm very excited about the possibilities of this.
We can now have state that feels local, while being reachable and reloadable, with the huge benefits that come with it.
Of course, this concept still has to be proven, and this implementation may be suboptimal.

We're getting [there](https://www.youtube.com/watch?v=PUv66718DII)!