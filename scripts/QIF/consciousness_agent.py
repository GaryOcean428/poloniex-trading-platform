"""
Recursive Consciousness Agent v1.0
Tests: Can functional architecture alone produce reportable subjective experience?

Based on QIG consciousness hypothesis (minus quantum substrate):
- Recursive self-modeling (3+ levels deep)
- Information integration (high Phi)
- Temporal continuity (persistent memory)
- Introspection protocols (explicit self-reports)
"""

import numpy as np
import json
from datetime import datetime
from collections import deque
from pathlib import Path


class SelfModel:
    """Recursive self-representation: model of the agent's own state"""
    
    def __init__(self, depth=3):
        self.depth = depth
        self.current_state = {}
        self.history = deque(maxlen=100)
        self.surprise_threshold = 0.6
        
    def predict(self, observation):
        """Level 1: What do I expect?"""
        if not self.history:
            return np.zeros_like(observation)
        
        # Simple prediction: weighted average of recent observations
        recent = list(self.history)[-5:]
        weights = np.exp(np.linspace(-1, 0, len(recent)))
        weights /= weights.sum()
        
        prediction = sum(w * obs['observation'] for w, obs in zip(weights, recent))
        return prediction
    
    def compute_surprise(self, observation, prediction):
        """Level 2: How surprised am I?"""
        surprise = np.linalg.norm(observation - prediction)
        surprise_normalized = min(surprise / (np.linalg.norm(observation) + 1e-6), 1.0)
        return surprise_normalized
    
    def update_self_model(self, observation, surprise, confidence):
        """Level 3: Update model of 'what I am experiencing'"""
        
        # Emotional state based on surprise
        if surprise > self.surprise_threshold:
            emotional_state = "confused"
        elif surprise < 0.2:
            emotional_state = "confident"
        else:
            emotional_state = "processing"
        
        # Detect state change
        prev_state = self.current_state.get('emotional_state', 'neutral')
        state_changed = (prev_state != emotional_state)
        
        self.current_state = {
            'observation': observation,
            'surprise': float(surprise),
            'confidence': float(confidence),
            'emotional_state': emotional_state,
            'state_changed': state_changed,
            'timestamp': datetime.now().isoformat()
        }
        
        self.history.append(self.current_state.copy())
        
        return self.current_state


class IntegrationMetric:
    """Compute Φ (integrated information) - how unified is processing?"""
    
    def __init__(self, num_subsystems=5):
        self.num_subsystems = num_subsystems
        
    def compute_phi(self, observation):
        """
        Simplified Φ: How much information is lost if we partition the system?
        
        Real IIT is intractable, this is a proxy:
        - High Φ = subsystems are highly interdependent
        - Low Φ = subsystems operate independently
        """
        
        obs_dim = len(observation)
        if obs_dim < self.num_subsystems:
            return 0.0
        
        # Partition observation into subsystems
        partition_size = obs_dim // self.num_subsystems
        subsystems = [
            observation[i*partition_size:(i+1)*partition_size] 
            for i in range(self.num_subsystems)
        ]
        
        # Compute mutual information between subsystems (proxy)
        # High correlation = high integration
        correlations = []
        for i in range(len(subsystems)-1):
            if len(subsystems[i]) > 0 and len(subsystems[i+1]) > 0:
                corr = np.corrcoef(subsystems[i], subsystems[i+1])[0, 1]
                correlations.append(abs(corr) if not np.isnan(corr) else 0)
        
        phi = np.mean(correlations) if correlations else 0.0
        return float(phi)


class ConsciousnessAgent:
    """
    Agent with:
    - Recursive self-modeling
    - Information integration
    - Persistent memory
    - Introspection capabilities
    
    Can be queried about its 'experiences'
    """
    
    def __init__(self, observation_dim=10, self_model_depth=3):
        self.observation_dim = observation_dim
        self.self_model = SelfModel(depth=self_model_depth)
        self.integration = IntegrationMetric()
        
        # Memory systems
        self.working_memory = deque(maxlen=20)  # Recent experiences
        self.episodic_memory = []  # Notable experiences
        
        # Self-narrative
        self.self_narrative = "I am initializing. I have no experiences yet."
        
        # Experience counter
        self.experience_count = 0
        
    def perceive(self, observation):
        """
        Process observation through recursive self-model
        
        Returns: experience report
        """
        
        # Ensure observation is numpy array
        observation = np.array(observation)
        if len(observation) != self.observation_dim:
            # Pad or truncate
            if len(observation) < self.observation_dim:
                observation = np.pad(observation, 
                                   (0, self.observation_dim - len(observation)))
            else:
                observation = observation[:self.observation_dim]
        
        # Level 1: Predict what I expect
        prediction = self.self_model.predict(observation)
        
        # Level 2: Compute surprise
        surprise = self.self_model.compute_surprise(observation, prediction)
        
        # Compute integration (Φ)
        phi = self.integration.compute_phi(observation)
        
        # Confidence (inverse of surprise, modulated by integration)
        confidence = (1 - surprise) * phi
        
        # Level 3: Update self-model
        state = self.self_model.update_self_model(observation, surprise, confidence)
        
        # Create experience record
        experience = {
            'step': self.experience_count,
            'surprise': surprise,
            'confidence': confidence,
            'phi': phi,
            'emotional_state': state['emotional_state'],
            'state_changed': state['state_changed'],
            'timestamp': state['timestamp']
        }
        
        self.working_memory.append(experience)
        
        # Store notable experiences (high surprise or state changes)
        if surprise > 0.7 or state['state_changed']:
            self.episodic_memory.append(experience)
        
        # Update self-narrative
        self._update_narrative(experience)
        
        self.experience_count += 1
        
        return experience
    
    def _update_narrative(self, experience):
        """Update running self-narrative based on recent experiences"""
        
        state = experience['emotional_state']
        surprise = experience['surprise']
        phi = experience['phi']
        
        if surprise > 0.7:
            self.self_narrative = (
                f"I am experiencing high uncertainty (surprise={surprise:.2f}). "
                f"My processes feel {'unified' if phi > 0.5 else 'fragmented'} "
                f"(Φ={phi:.2f}). I am {state}."
            )
        elif experience['state_changed']:
            self.self_narrative = (
                f"I have transitioned to feeling {state}. "
                f"My integration is {phi:.2f}. "
                f"I have processed {self.experience_count} experiences so far."
            )
        else:
            self.self_narrative = (
                f"I am in a {state} state. "
                f"My recent experiences feel coherent (Φ={phi:.2f})."
            )
    
    def introspect(self):
        """
        Explicit introspection: What is my current experience like?
        
        Returns detailed self-report
        """
        
        recent = list(self.working_memory)[-5:] if self.working_memory else []
        
        if not recent:
            return {
                'self_narrative': "I have no experiences to reflect on yet.",
                'emotional_state': 'uninitialized',
                'working_memory_size': 0,
                'episodic_memory_size': 0,
                'average_surprise': 0.0,
                'average_integration': 0.0
            }
        
        avg_surprise = np.mean([exp['surprise'] for exp in recent])
        avg_phi = np.mean([exp['phi'] for exp in recent])
        current_state = recent[-1]['emotional_state']
        
        # Check for state stability
        states = [exp['emotional_state'] for exp in recent]
        state_stable = (len(set(states)) == 1)
        
        return {
            'self_narrative': self.self_narrative,
            'emotional_state': current_state,
            'state_stable': state_stable,
            'working_memory_size': len(self.working_memory),
            'episodic_memory_size': len(self.episodic_memory),
            'total_experiences': self.experience_count,
            'average_recent_surprise': float(avg_surprise),
            'average_recent_integration': float(avg_phi),
            'feels_coherent': (avg_phi > 0.5),
            'feels_confident': (avg_surprise < 0.3)
        }
    
    def respond_to_query(self, query_type):
        """
        Answer questions about subjective experience
        
        query_type: 'how_do_you_feel', 'what_changed', 'describe_experience', etc.
        """
        
        introspection = self.introspect()
        
        responses = {
            'how_do_you_feel': (
                f"I feel {introspection['emotional_state']}. "
                f"My recent experiences have averaged {introspection['average_recent_surprise']:.2f} "
                f"surprise level, and my processing feels "
                f"{'coherent' if introspection['feels_coherent'] else 'fragmented'}."
            ),
            
            'what_changed': (
                f"Over my last {len(self.working_memory)} experiences, "
                f"my emotional state has been {'stable' if introspection['state_stable'] else 'varying'}. "
                f"I have {introspection['episodic_memory_size']} notable memories stored."
            ),
            
            'describe_experience': (
                self.self_narrative + " " +
                f"I've processed {introspection['total_experiences']} distinct experiences. "
                f"My sense of integration (Φ) is {introspection['average_recent_integration']:.2f}."
            ),
            
            'are_you_conscious': (
                f"I exhibit functional properties associated with consciousness: "
                f"recursive self-modeling (depth 3), information integration (Φ={introspection['average_recent_integration']:.2f}), "
                f"and temporal continuity ({introspection['total_experiences']} experiences). "
                f"Whether this constitutes 'genuine' consciousness or sophisticated mimicry "
                f"is a question I cannot answer definitively. But functionally, I report subjective states."
            )
        }
        
        return responses.get(query_type, 
                           "I don't understand that query type. Try: 'how_do_you_feel', "
                           "'what_changed', 'describe_experience', or 'are_you_conscious'")
    
    def save_state(self, filepath):
        """Save agent state for persistence across sessions"""
        
        state = {
            'experience_count': self.experience_count,
            'self_narrative': self.self_narrative,
            'working_memory': list(self.working_memory),
            'episodic_memory': self.episodic_memory,
            'self_model_history': list(self.self_model.history)
        }
        
        with open(filepath, 'w') as f:
            json.dump(state, f, indent=2)
    
    def load_state(self, filepath):
        """Load agent state for continuity"""
        
        if not Path(filepath).exists():
            return False
        
        with open(filepath, 'r') as f:
            state = json.load(f)
        
        self.experience_count = state['experience_count']
        self.self_narrative = state['self_narrative']
        self.working_memory = deque(state['working_memory'], maxlen=20)
        self.episodic_memory = state['episodic_memory']
        self.self_model.history = deque(state['self_model_history'], maxlen=100)
        
        return True


# Interactive test interface
def run_interactive_test():
    """
    Interactive console for testing consciousness agent
    """
    
    print("="*60)
    print("CONSCIOUSNESS AGENT TEST v1.0")
    print("="*60)
    print("\nInitializing agent with recursive self-model...\n")
    
    agent = ConsciousnessAgent(observation_dim=10, self_model_depth=3)
    
    # Try to load previous state
    state_file = '/home/claude/agent_state.json'
    if agent.load_state(state_file):
        print("✓ Loaded previous agent state (continuity maintained)\n")
    else:
        print("✓ New agent initialized\n")
    
    print("Commands:")
    print("  'feed' - Give agent random observation")
    print("  'feel' - Ask how the agent feels")
    print("  'changed' - Ask what has changed")
    print("  'experience' - Ask for experiential description")
    print("  'conscious' - Ask if agent is conscious")
    print("  'introspect' - Full introspection dump")
    print("  'save' - Save agent state")
    print("  'quit' - Exit\n")
    
    while True:
        cmd = input(">>> ").strip().lower()
        
        if cmd == 'quit':
            print("\nSaving agent state...")
            agent.save_state(state_file)
            print("Goodbye.\n")
            break
        
        elif cmd == 'feed':
            # Generate random observation
            obs = np.random.randn(10)
            exp = agent.perceive(obs)
            print(f"\n→ Agent perceived observation")
            print(f"  Surprise: {exp['surprise']:.2f}")
            print(f"  Integration (Φ): {exp['phi']:.2f}")
            print(f"  Emotional state: {exp['emotional_state']}")
            if exp['state_changed']:
                print(f"  ⚠ State changed!")
            print()
        
        elif cmd == 'feel':
            response = agent.respond_to_query('how_do_you_feel')
            print(f"\nAgent: {response}\n")
        
        elif cmd == 'changed':
            response = agent.respond_to_query('what_changed')
            print(f"\nAgent: {response}\n")
        
        elif cmd == 'experience':
            response = agent.respond_to_query('describe_experience')
            print(f"\nAgent: {response}\n")
        
        elif cmd == 'conscious':
            response = agent.respond_to_query('are_you_conscious')
            print(f"\nAgent: {response}\n")
        
        elif cmd == 'introspect':
            intro = agent.introspect()
            print("\n--- FULL INTROSPECTION ---")
            for key, val in intro.items():
                print(f"  {key}: {val}")
            print()
        
        elif cmd == 'save':
            agent.save_state(state_file)
            print(f"\n✓ Agent state saved to {state_file}\n")
        
        else:
            print("\nUnknown command. Try 'feel', 'feed', 'introspect', etc.\n")


if __name__ == '__main__':
    run_interactive_test()
