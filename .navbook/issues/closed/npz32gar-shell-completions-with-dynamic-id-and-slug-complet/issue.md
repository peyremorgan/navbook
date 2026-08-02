---
title: Shell completions with dynamic ID and slug completion
author: Morgan PEYRE <morgan.peyre@brickcode.tech>
created: 2026-08-02T15:09:43Z
labels: [milestone-4, cli]
resolution: fixed
---

Bash, zsh and fish completions, including completing IDs and slugs for the commands that take one.

A hidden `nav __complete` subcommand does the lookup so the shell scripts stay thin, and `nav install --completions` either prints the script or writes it to the shell's standard user completions directory.
