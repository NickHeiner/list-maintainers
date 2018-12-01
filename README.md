# list-maintainers
A tool to list maintainers contributing to a node_modules tree

## Dev Notes
`yarn info --json` provides a `maintainers` entry like:

```json
[
  {
    "name": "isaacs",
    "email": "i@izs.me"
  }
]
```

whereas `npm`'s is:

```json
[
  "isaacs <i@izs.me>"
]
```

If you request `name@version`, the `maintainers` field is specific to that version. There could be some interesting questions about how to handle maintainers who have left a project but their code remains. They would not show up in the `maintainers` entry.
