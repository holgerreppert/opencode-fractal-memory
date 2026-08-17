Here are practical guidelines that work well in real TypeScript codebases:

    Prefer composition over inheritance
    Build objects out of smaller pieces (functions, injected collaborators, interfaces) rather than creating deep class hierarchies. Inheritance often becomes rigid and harder to refactor.

    Program to interfaces (or types), not to concrete classes
    Use interfaces/types to define what a class can do, and depend on those in consumers (e.g., constructor(private repo: UserRepository)).

    Keep classes cohesive and small
    A class should usually have one reason to change. If it’s managing too many concerns (persistence + business rules + UI formatting), split it.

    Make state intentional and controlled
        Keep fields private by default.
        Avoid exposing mutable objects directly; return copies or readonly views where appropriate.

    Use readonly for invariants
    If a property shouldn’t change after construction, mark it readonly. This pushes bugs from runtime to compile-time.

    Favor immutable data where practical
    Especially for value objects (e.g., Money, Email, Coordinates). Immutability makes behavior easier to reason about.

    Use abstract classes sparingly; interfaces more often
    If you want shared implementation, an abstract class can help. But for contracts, interfaces are usually cleaner.

    Don’t overuse private/protected inheritance tricks
    In TS/JS, inheritance doesn’t always map cleanly to runtime flexibility. If you need polymorphism, aim for clear public APIs and minimal “cleverness” in the hierarchy.

    Keep polymorphism at the boundaries
    For example: domain services and repository interfaces. Avoid pushing inheritance deep inside “leaf” logic where it creates complexity.

    Leverage discriminated unions instead of class hierarchies for many domain models
    For things like events, states, or results, unions often lead to simpler, safer code than a class tree.

    Avoid “anemic models”
    If you make classes that mostly just hold data and all logic lives elsewhere, you lose the benefit of OOP. Either:
        move behavior into the model (if it truly belongs there), or
        switch to plain types + functions if that better matches the domain.

A quick rule of thumb:

    Use classes for entities/services with behavior and lifecycle.
    Use interfaces/types for contracts and data shapes.
    Use composition and dependency injection to wire behavior together.
    Use unions for state/event variants.
