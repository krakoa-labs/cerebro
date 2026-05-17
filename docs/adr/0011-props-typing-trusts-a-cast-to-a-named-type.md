# Props typing trusts a cast to a named type

Props typing reports `typed` for a Component declared as a cast to a named type — `const Button = forwardRef((props, ref) => …) as ForwardRefComponent<"button", Props>`. This cast is the polymorphic-ref typing workaround: the inner `forwardRef` callback destructures its props with no inline annotation because the surrounding `as` cast already supplies the contract. The cast is treated as an explicit type annotation on the Component, the same way a `forwardRef<Ref, Props>(…)` call's own type arguments and an `FC<Props>` variable annotation already are (ADR-0005 establishes that Props typing reads the syntax of the declaration, not a resolved type).

The cast is trusted *structurally*, not by name: the target must be a named type reference (`TSTypeReference`), and the wrapped expression must itself resolve to a component (a function form, or a `forwardRef`/`memo` wrapper). The names `ForwardRefComponent` / `MemoComponent` are not matched — they are local to one design system, and Cerebro stays generic.

## Considered Options

Seeing through the cast as noise — the way `definitionKind` peels type wrappers with `skipTypeWrappers` — was the first instinct, but it is wrong here: for `definitionKind` a cast does not change function-vs-class, whereas for Props typing the cast *is* the signal. Peeling it would expose the unannotated inner callback and manufacture a false `untyped` verdict, exactly the false debt ADR-0005 forbids.

Whitelisting the component-type names (`ForwardRefComponent`, `MemoComponent`, …) like `FC`/`FunctionComponent` are whitelisted was rejected: those names are a design-system convention, not a React or TypeScript primitive, so a name list would silently fail on every other team's equivalent type. Requiring the cast target to carry type arguments was also considered and rejected — it would be inconsistent with the existing `FC` rule, which accepts a bare `FC` annotation with no arguments.

## Consequences

A `!` non-null assertion, and a cast whose target is not a named type (`as any`, `as () => JSX.Element`, `as { … }`), carry no props contract; they are transparent and the value beneath is classified normally. A cast over a non-component value (`config as Settings`) stays `unanalyzed` — the target being a named type is not on its own enough; the cast must wrap a component. A wrapper applied to a bare identifier under a cast (`memo(Imported) as MemoComponent<Props>`) also stays `unanalyzed`: Props typing does not resolve identifiers across declarations, and the cast does not change that the wrapped component cannot be seen.
