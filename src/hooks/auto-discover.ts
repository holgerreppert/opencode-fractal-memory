// Playbook auto-discovery is now agent-driven.
// The agent proposes playbooks when it notices repeated multi-step workflows.
// Creates them via memory_set(label, ..., type: "playbook", sticky: true, metadata: { steps: [...] }).
