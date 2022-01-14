{:title "Some re-frame patterns for composability"
 :layout :post
 :tags  ["Clojure" "Programming" "Architecture" "re-frame"]
 :toc true
 :date "2021-01-14"}


This article proposes some strategies for making [re-frame](https://github.com/day8/re-frame) codebases more maintainable, chiefly by making components and events more reusable. The main idea is to enable customization by callers, by **allowing callers to inject events, subscriptions, app-db paths and even callback functions as arguments.** This approach is not conceptually difficult, but we found it unintuitive when we started using re-frame.

We have been using these patterns over the course of 1.5 years at [Ytems](https://www.ytems.co/) (an accounting platforms for accountants focused on independent contractors), for implementing the back-office of accountants, a re-frame networked browser app requiring advanced ergonomics for viewing, searching and editing accounting records, related information, and account customization.

This article hopes to foster consideration and criticism of the suggested patterns. It might also serve to outline some consequences and limitations of re-frame's design.


## Parameterizing components with an app-db path

### Introduction: where to store state

A frequent requirement for a re-frame component is to maintain some subset of the app-db, typically a map nested in the app-db at a given path.

If that path is hardcoded, the reusability of the component will be very limited. Therefore, I recommend you **consider providing the app-db path as an argument to the component.** Here's a code example, for an imaginary Git platform called MyGit:

```clojure
(ns mygit.ui.merge-request-viewer
  (:require [re-frame.core :as rf]))


;; NOT PORTABLE: hardcoded app-db path

(defn <merge-request-viewer>
  [mreq]
  (let [local-state @(rf/subscribe [::get-local-state (:mygit.merge-request/id mreq)])
        {collapsed? ::collapsed} local-state]
    ...))

(rf/reg-sub ::get-local-state
  (fn [app-db [_ mreq-id]]
    (get-in app-db
      ;; Notice how the app-db path is hardcoded here:
      [::mreq-id->local-state mreq-id])))



;; MORE PORTABLE: app-db path supplied by caller

(defn <merge-request-viewer>
  [path_local-state mreq]
  (let [local-state @(rf/subscribe [::get-local-state path_local-state])
        {collapsed? ::collapsed} local-state]
    ...))

(rf/reg-sub ::get-local-state
  (fn [app-db [_ path_local-state]]
    (get-in app-db path_local-state)))
```

Your component how has a slightly longer signature; more importantly, it has one fewer concern: storage location of state, better handled by a caller who knows more context.


### Generic subscriptions and events for app-db paths

Once you use app-db paths, subscriptions which do nothing more than call `get-in` become so frequent that I recommend writing a generic subscription for that:


```clojure
(ns mygit.utils.re-frame
  (:require [re-frame.core :as rf]))

(rf/reg-sub ::get-in
  (fn [app-db [_ app-db-path default-value]]
    (get-in app-db app-db-path default-value)))

(comment
  "Use the above as follows, assuming a path named" path_local-state ":"
  (let [my-local-state @(rf/subscribe [::get-in path_local-state])]
    ...))
```

You might feel uneasy with using such a blindly generic subscription _("Aren't re-frame subscriptions supposed to be more domain-specific?")_. Yet, we've found that using `::get-in` is often an improvement over a custom subscription, which would be excessive indirection and abstraction.


The same principle holds for events:

```clojure
(rf/reg-event-db ::assoc-in
  (fn [app-db [_ app-db-path v]]
    (assoc-in app-db app-db-path v)))

(comment
  "Use the above as follows:"
  (rf/dispatch [::assoc-in path_local-state {:some "value"}]))


(rf/reg-event-db ::dissoc-in
  (fn [app-db [_ app-db-path ks]]
    (assert (seqable? ks))
    (update-in app-db app-db-path
      (fn [v]
        (apply dissoc v ks)))))


(rf/reg-event-db ::update-in
  ;; this one is a bit more controversial, because not data-oriented. Tread lightly.
  (fn [app-db [_ app-db-path f & args]]
    (apply update-in app-db app-db-path f args)))
```


### What about Reagent cursors?

Indeed, paths have semantics similar to Reagent cursors. However, AFAICT, Reagent cursors are simply incompatible with re-frame's design, by virtue of being mutable. Re-frame does not want you to manage its app-db through side-effects as with a Ratom: you're supposed to go through re-frame's effect system, and the re-frame app-db Ratom is not part of the public API.



## Callback events and partial'd events

### For components

In a similar vein, a re-frame component might need to dispatch different events depending on the context in which it is used. At this point, it makes sense for these **events to be dynamically provided as arguments by the caller** (and so we call them _callback events_).


**Example: generic confirmation modal.** Imagine you want to program a generic component which prompts the user to confirm or cancel some action:


```clojure
;; Caller code

(ns mygit.ui.merge-request
  (:require [mygit.ui.confirmation-modal]))


(defn <modal-delete-merge-request>
  [mreq-id]
  [mygit.ui.confirmation-modal/<modal-prompting-confirmation>
   "Are you sure you want to delete this Merge Request?"
   [::delete-merge-request mreq-id] ;; NOTE: the caller provides the events to be dispatched by the child component.
   [::hide-delete-mreq-modal]])

(rf/reg-event-fx ::delete-merge-request (fn [cofx [_ mreq-id]] ...))
(rf/reg-event-db ::hide-delete-mreq-modal (fn [app-db _] ...))

...

(defn <modal-discard-comment>
  [path_comment-draft]
  [mygit.ui.confirmation-modal/<modal-prompting-confirmation>
   "Are you sure you want to discard this comment?"
   [::discard-comment path_comment-draft]
   [::hide-discard-comment]])

(rf/reg-event-fx ::discard-comment (fn [cofx [_ path_comment-draft]] ...))
(rf/reg-event-db ::hide-discard-comment (fn [app-db _] ...))


;; Called code

(ns mygit.ui.confirmation-modal)

(defn <modal-prompting-confirmation>
  [question-text evt_when-confirmed evt_when-cancelled]
  [:div
   ...
   [:p question-text]
   ...
   ;; NOTE: the events to dispatch are opaque values to this component.
   [:button {:on-click #(rf/dispatch evt_when-confirmed)} "Confirm"]
   [:button {:on-click #(rf/dispatch evt_when-cancelled)}] "Cancel"])
```

**Limitation:** if both the component and its caller want to request effects at the same time, you might find callback events limiting. We discuss potential solutions below with _[Effects-Requesting Callback Functions](#effects-requesting_callback_functions)_.


### For effects and events

The same logic applies **for re-frame effects and events: their handler function might accept callback events as parameters.**

**Example: backend API.** Typically, you might have an effect `:mygit.effect/call-backend-api`. Its effect handler must know what event to dispatch when the API response arrives:


```clojure
(ns mygit.effect
  (:require [re-frame.core :as rf]))

(rf/reg-fx ::call-backend-api
  (fn [{:as api-request, pevt_handle-response ::pevt_handle-api-response}]
    ...
    (call-backend-api (dissoc api-request ::pevt_handle-api-response)
      (fn [api-response]
        ;; NOTE the supplied event tuple is used as a (partial'd) callback function:
        ;; we inject the api response as its last argument.
        (rf/dispatch (conj pevt_handle-response api-response))))
    (comment pevt_... "stands for Partial'd EVenT,"
      "in the spirit of" clojure.core/partial)
    ...))


;; Caller code

(ns mygit.ui.merge-request
  (:require [mygit.effect]
            [re-frame.core :as rf]))

(rf/reg-event-fx ::refresh-merge-request--init
  (fn [cofx [_ mreq-id]]
    {:fx [[:mygit.effect/call-backend-api
           {:http/method :http/get
            :mygit.backend-api/endpoint (str "/merge-request/" mreq-id "/details")
            ;; !!! HERE !!! example of partial'd callback event below:
            :mygit.effect/pevt_handle-api-response [::refresh-merge-request--succeed mreq-id]}]
          ...]
     :db ...}))


(rf/reg-event-db ::refresh-merge-request--succeed
  (fn [app-db [_ mreq-id api-response]]
    (let [mreq-details (:mygit.backend-api/result api-response)]
      ...)))
```

Let's recap **how we came to this design:**

1. Asynchronous effects (like `:mygit.effect/call-backend-api`) must trigger side-effects when they complete.
2. Re-frame wants you to trigger side-effects by dispatching an event.
3. Therefore, an async re-frame effect will need to dispatch an event, and inject resolved data into it.
4. Thus, re-frame naturally invites us to use some events as (partial'd) callback functions.

Arguably, it is a weakness of re-frame that it makes us use events as callback functions, yet does not provide events with the expressive power and composability of actual Clojure functions: there is no such thing as anonymous events, higher-order events, etc.




## Parameterizing components with subscriptions

You know the drill by now: we've parameterized Reagent components with app-db paths and events, some why not subscriptions? Indeed, why not: **consider writing components which accept re-frame subscriptions as arguments.** In pseudo-code:

```clojure
(defn <my-component>
  [sub_fetch-my-data ...]
  (let [my-data @(rf/subscribe sub_fetch-my-data)]
    ...))
```

As before, the motivation is that `<my-component>` might not have enough context to know what subscription to use, so that's better left to its callers.

Semantically, a subscription vector can be viewed as a not-yet-evaluated function call for resolving data.




## Parameterizing subscriptions with subscriptions

Can we do that? Yes we can! Here's an example, for the use case of displaying a list of MyGit issues in a filtering UI:

```clojure
(ns mygit.ui.issues
  (:require [re-frame.core :as rf]))


(rf/reg-sub ::displayed-issues
  (fn signals [[_ project-id sub_filter-fn]]
    [(rf/subscribe [::all-issues project-id])
     (rf/subscribe sub_filter-fn)])
  (fn [[all-issues filter-fn] _]
    (->> all-issues (filter filter-fn) (vec))))
```



## Effects-requesting callback functions

### Introduction: requesting effects non-exhaustively

Sometimes, a components needs to trigger some side-effects, but some of those side-effects are better known by the callers, while others are better known by the component. For example, the caller of a form component might want to perform some context-specific side-effects after the form has been submitted (like moving to another page), while at the same time the form component itself has to perform some clean-up side-effects.

When that happens, one approach is to dispatch 2 events, either in parallel or serially. We'll consider such a multi-events approach [below](#alternative:_dispatching_several_events), but it has downsides, and so for now **we'll assume that all effects must happen in one event handler,** a requirement we call the _all-effects-in-one-event constraint_.

In this case, it is not very suitable for the caller to provide a callback event: the caller-side event handler would have to know internal details of the called component.

So here's an alternative to consider: **the caller provides a callback function, to be invoked in the component's event handler.** Such a callback function accepts a re-frame Effects Map and returns it enriched with new effects.

**Example: optional effects after saving a comment.** Imagine an editor for comments on MyGit issues, which in some contexts might need to perform some side-effects after saving, like displaying the next unanswered comment:

```clojure
(ns mygit.ui.comment.editor
  (:require [re-frame.core :as rf]))


(defn <comment-editor>
  [editor-opts ...]
  ...)


(rf/reg-event-fx ::save-comment--succeed ;; triggered when the backend tells us that the comment has been successfully saved.
  (fn [cofx [_ editor-opts comment-data]]
    (let [fx-map {:db (-> (:db cofx)
                        (sync-comment-in-app-db comment-data)
                        (cleanup-comment-editor-state editor-opts))}]
      (if-some [callback-fn (::add-fx_after-saving-comment editor-opts)]
        (callback-fn fx-map cofx comment-data) ;; <-- HERE
        fx-map))))


;; Caller code

(ns mygit.ui.unanswered-comments
  (:require [mygit.ui.project.queries :as project-queries]
            [mygit.ui.comment.editor :as cmt-editor]
            [reagent.core]))


(defn offer-to-answer-comment
  "Changes the UI state, prompting the user to answer the given Comment. Returns an updated re-frame app-db."
  [app-db cmt]
  (-> app-db
    (update-in ...)
    ...))


(defn add-fx_move-to-next-unanswered-comment
  [project-id fx-map cofx _comment-data]
  (comment add-fx_do-some-stuff "stands for Add Effects which Do Some Stuff.")
  (if-some [next-unanswered-cmt (project-queries/find-next-unanswered-comment-for-project (:db cofx) project-id)]
    (assoc fx-map
      :db
      (let [app-db (or (:db fx-map) (:db cofx))]
        (offer-to-answer-comment app-db next-unanswered-cmt)))
    fx-map))


(defn <unanswered-comments-wizard>
  [project-id ...]
  [:div ...
   [cmt-editor/<comment-editor>
    {;; HERE the caller supplies the callback.
     ::cmt-editor/add-fx_after-saving-comment (reagent.core/partial add-fx_move-to-next-unanswered-comment project-id)}
    (comment reagent.core/partial "is used for performance: it preserves Reagent caching."
      "For this use case, it is probably not necessary.")
    ...]])
```


### Discussion: aren't callback functions at odds with re-frame's data orientation?

I understand the sentiment, and used to have similar misgivings: the arguments to a re-frame event are usually supposed to be information-supporting data structures, not functions.

That said, if your essential requirement is to customize event handling with arbitrary behaviour from the caller, then a callback function is a natural fit for that, more so than a data structure. Of course, instead of a callback function, you could also inject a Clojure Record implementing a protocol; that might make you feel better, but you'd probably be over-engineering it, and the semantics would be the same.

In particular, if you find yourself writing an interpreter for a homemade data-encoded domain-specific language to customize some event handler, then I suspect you're going astray, burdening your project with a hard challenge and inaccessible abstractions for a mirage of data-orientation. If you need an expressive language for customizing your event handling, use Clojure instead of reinventing it, and don't be shy about using callback functions: they're not data, but at least they're honest about it.


### Alternative: dispatching several events

Another strategy would be to dispatch 2 events, one for the component-level effects and one for the caller-level effects. Concretely, continuing with the above example:

```clojure
(ns mygit.ui.comment.editor
  (:require [re-frame.core :as rf]))

...

(rf/reg-event-fx ::save-comment--succeed ;; triggered when the backend tells us that the comment has been successfully saved.
  (fn [cofx [_ editor-opts comment-data]]
    {:db (-> (:db cofx)
           (sync-comment-in-app-db comment-data)
           (cleanup-comment-editor-state editor-opts))
     :fx (when-some [pevt (::pevt_after-saving-comment editor-opts)] ;; <-- HERE
           [[:dispatch (conj pevt comment-data)]])}))
```

I'm not sure to what extent this is encouraged or discouraged by re-frame. I've seen several code examples by re-frame authors featuring the `:dispatch` effect, suggesting that cascading events are acceptable practice. OTOH, starting from 1.1.0, re-frame has evolved to facilitate implementing event handlers which are a conjunction of behaviours contributed by separate parts of the app: it's become more straightforward to write event handlers which "do many things", which might make the use of `:dispatch` less legitimate.

I see various **potential issues with using `:dispatch`,** compared to a direct update of the `fx-map`:

1. The state transition is **no longer atomic:** the app-db might go through some incorrect state between both events.
1. Testing the event handler may become more challenging, as the effects of the callback event won't visible when it returns.
1. The causality between both events might be harder to keep track of when debugging (although tooling like re-frame-10x seem to help with that).
1. The callback might also want to alter the fx-map in non-additive-ways before it ever runs: prevent some effects from happening, throw an error if it detects an inconsistency, etc.
1. More generally, I find the execution model of dispatching another event more convoluted, compared to having everying happen in one pure function call.

All in all, I'm inconclusive: in many cases, these issues won't be a big deal, so dispatching 2 events might be just fine. Still, I expect fewer limitations to callback functions.


### Some utils for rf/reg-event-fx


Once using callback functions (and even without them), we tend to use `reg-event-fx` a lot, and have found the following functions to be quite handly for writing event handlers:

```clojure
(ns mygit.utils.re-frame)


(defn add-fx_update-app-db
  "Utility for updating the app-db in a reg-event-fx handler.

  Given:
  - `fx-map`, a re-frame Effects map, (as returned by the handler)
  - `cofx`, a re-frame Co-Effects map, (1st argument of the handler)
  - `transform-db-fn`, an app-db-transforming function,
  returns a transformed `fx-map` with a :db entry holding a new app-db,
  updated by calling `transform-db-fn`."
  [fx-map cofx transform-db-fn]
  (let [app-db (or ;; Nontrivial: reading the app-db from the right place.
                 (get fx-map :db)
                 (get cofx :db))
        new-app-db (transform-db-fn app-db)]
    (assoc fx-map :db new-app-db)))


(defn add-fx_append-effect
  "Utility for adding an effect in a reg-event-fx handler.

  Given:
  - `fx-map`, a re-frame Effects map,
  - `rf-effect-tuple`, a re-frame Effect tuple (e.g [:dispatch my-event]),
  transforms `fx-map` so that it requests the effect represented by `rf-effect-tuple`."
  [fx-map rf-effect-tuple]
  (update fx-map :fx #(-> % (or []) (conj rf-effect-tuple))))


(defn add-fx_from-optional-fn
  [fx-map cofx f-or-nil & args]
  "Utility for applying an optional callback function in a reg-event-fx handler.

  Given:
  - `fx-map`, a re-frame Effects map, (as returned by the handler)
  - `cofx`, a re-frame Co-Effects map, (1st argument of the handler)
  - `f-or-nil`, either nil or a function ([fx-map cofx & args] -> fx-map)
  - `& args`, additional arguments to `f-or-nil`
  returns an fx-map enriched by calling f-or-nil, when applicable."
  (if (nil? f-or-nil)
    fx-map
    (apply f-or-nil fx-map cofx args)))
```

With these, our example re-frame handler becomes more readable:

```clojure
(ns mygit.ui.comment.editor
  (:require [mygit.utils.re-frame :as urf]
            [re-frame.core :as rf]))

...

(rf/reg-event-fx ::save-comment--succeed ;; triggered when the backend tells us that the comment has been successfully saved.
  (fn [cofx [_ editor-opts comment-data]]
    (-> {}
      (urf/add-fx_update-app-db cofx
        (fn [app-db]
          (-> app-db
            (sync-comment-in-app-db comment-data)
            (cleanup-comment-editor-state editor-opts))))
      (urf/add-fx_from-optional-fn cofx (::add-fx_after-saving-comment editor-opts)))))

...
```


## Consider bypassing re-frame's Effects System altogether

So far, this article has striven to stay in line with re-frame's intentions regarding the management of state and side-effects, and so we've only been exploring patterns that make use of re-frame's _effects system_: `rf/dispatch`, `rf/reg-event-fx`, `rf/reg-fx`, etc. However, **re-frame's effects system is strongly opinionated, and these opinions might not always fit your requirements well.** For example:

1. re-frame's API design puts high priority on enforcing Clojure-level purity and data-orientation (which are not always the most critical concerns in a front-end codebase),
1. its event-driven programming interface is relatively clumsy for asynchronous programming (compared to using, say, Promises),
1. it makes you program effects by emitting code and writing interpreter extensions for a low-expressiveness imperative language.

I'm not saying that those things are absolutely wrong, and the expected benefits of re-frame's effect system have been abundantly documented, but with such strong design orientations it is no surprise that these benefits are sometimes accompanied by significant shortcomings. Therefore, it seems reasonable to **consider using re-frame only for its subscriptions API and not its effects system,** at least in some parts of your project. Concretely, that means programming side-effects without `rf/dispatch`, `rf/reg-event-db`, `rf/reg-event-fx`, etc. Doing so is not very hard - here's a utility function that might help you down that path:


```clojure
(ns mygit.utils.re-frame
  (:require [re-frame.core :as rf]))


(defn update-app-db!
  "Immediately transforms the re-frame app-db.

  If the app-db was held in an atom a, the semantics would be those of:

  (do (apply swap! a f args) nil)"
  [f & args]
  (rf/dispatch-sync [::update-app-db- f args])
  nil)

(rf/reg-event-db ::update-app-db-
  (fn [app-db [_ f args]]
    (apply f app-db args)))
```


Yet **another strategy is to bypass re-frame events, programming with effects alone.** Here's a function to help you do that:

```clojure
(defn trigger-effects!
  "Triggers effects by invoking the given callback function, which must return a re-frame Effects Map and accept a Co-Effects Map.

  Optionally, the effects can be triggered synchronously, i.e as if by reframe.core/dispatch-sync."
  ([request-effects-fn] (trigger-effects! request-effects-fn false))
  ([request-effects-fn sync?]
   (let [evt [::trigger-effects!- request-effects-fn]]
     (if sync?
       (rf/dispatch-sync evt)
       (rf/dispatch evt)))))

(rf/reg-event-fx ::trigger-effects!-
  (fn [cofx [_ request-effects-fn]]
    (request-effects-fn cofx)))
```


For instance, continuing with the [above example](#for_effects_and_events) of refreshing a Merge Request:


```clojure
(ns mygit.ui.merge-request
  (:require [mygit.effect]
            [mygit.utils.re-frame :as urf]
            [re-frame.core :as rf]))


(defn add-fx_refresh-merge-request
  [fx-map cofx mreq-id]
  (-> fx-map
    (urf/add-fx_update-app-db cofx ...)
    (urf/add-fx_append-effect
      [:mygit.effect/call-backend-api
       {:http/method :http/get
        :mygit.backend-api/endpoint (str "/merge-request/" mreq-id "/details")
        ;; Our call-backend-api effect now accepts a callback function, rather than a PEvent.
        :mygit.effect/add-fx_handle-response
        (fn add-fx_receive-mreq [fx-map cofx api-response]
          (-> fx-map
            (urf/add-fx_update-app-db cofx
              (fn [app-db]
                (let [mreq-details (:mygit.backend-api/result api-response)]
                  ...)))))}])))


(defn <button-refresh-merge-request>
  [mreq-id]
  [:button
   {:on-click #(urf/trigger-effects! ;; HERE requesting side-effects directly, without a re-frame event.
                 (fn [cofx] (add-fx_refresh-merge-request {} cofx mreq-id)))}
   "Refresh Merge Request"])
```


Programming with effects while bypassing events retains some interesting properties of re-frame: effects are still programmed with pure functions, although they're no longer requested in a data-oriented way. That said, the issue of asynchronous flow control remains: AFAICT, we can't get around using callbacks.


## Appendix: naming conventions

```clojure
(comment ;; CAST OF CHARACTERS:

  app-db "The re-frame app-db."

  fx-map "A re-frame Effects Map, which declares what side-effects must be performed, see:" ;; https://github.com/day8/re-frame/blob/master/docs/Effects.md#the-effects-map
  cofx "A re-frame CoEffects Map, see:" ;; https://github.com/day8/re-frame/blob/master/docs/EffectfulHandlers.md#the-coeffects
  add-fx_do-some-stuff "an effects-requesting function, with a signature like:" ([fx-map cofx ...] -> enriched-fx-map)
  "The above come together in a re-frame Event Handler:"
  (rf/reg-event-fx ::do-some-stuff
    (fn my-event-handler [cofx my-event]
      (let [[_event-name arg1 arg2] my-event]
        (-> {}
          (as-> fx-map
            (add-fx_do-some-stuff fx-map cofx arg1 arg2))))))

  <my-component> "A Reagent component."

  path_some-piece-of-state "A vector to locate a piece of state in the app-db, to be used with" get-in, assoc-in, update-in "etc."
  "Example:" [::merge-request-id->editor-state mreq-id ::unsaved-changes]

  evt_do-some-stuff "a re-frame Event, e.g" [:mygit.ui.merge-request/refresh-merge-request--succeed mreq-id api-response]
  pevt_do-some-stuff "a re-frame Partial'd Event, e.g" [:mygit.ui.merge-request/refresh-merge-request--succeed mreq-id]

  *e)
```


## Conclusion

The main principles behind the patterns we've described are:

1. Components can be made more portable by allowing their behaviour to vary depending on context. Callers are usually in a better position to know the context, so components are made more adaptable by accepting more arguments from callers.
1. In some situations, you might find it interesting to bypass some of re-frame's machinery for side-effects.

I'm not very happy to find myself programming with patterns, as I'd rather have projects rely on straightforward tools rather than style conventions and technical know-how. But I haven't found a better way with re-frame, and we should probably not expect front-end programming to be straightforward anyway, at least not in 2022.

It took us some time to come up with these patterns, and even more time before we dared use them; but we now believe they have a role to play in re-frame projects. Hopefully this can save others some work. Feedback is welcome.

Happy New Year!