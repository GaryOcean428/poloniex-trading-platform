import React from 'react';
import { MessageSquare, Users, Clock } from 'lucide-react';

const Chat: React.FC = () => {
  return (
    <div className="space-y-6">
      <div className="text-center max-w-2xl mx-auto py-12">
        <MessageSquare className="w-16 h-16 text-blue-500 mx-auto mb-4" />
        <h1 className="text-3xl font-bold text-text-primary mb-4">Community Chat</h1>
        <p className="text-lg text-text-secondary mb-8">
          Connect with other traders, share strategies, and discuss market trends in real-time.
        </p>
        
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 mb-8">
          <h2 className="text-xl font-semibold text-yellow-800 mb-2">Coming Soon</h2>
          <p className="text-yellow-700">
            The community chat feature is currently under development. 
            We're building a secure, real-time communication platform for traders.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-8">
          <div className="bg-bg-tertiary border border-border-subtle rounded-lg p-6">
            <Users className="w-8 h-8 text-blue-500 mx-auto mb-3" />
            <h3 className="font-semibold text-text-primary mb-2">Community Trading</h3>
            <p className="text-text-secondary text-sm">
              Share your trading strategies and learn from experienced traders.
            </p>
          </div>

          <div className="bg-bg-tertiary border border-border-subtle rounded-lg p-6">
            <MessageSquare className="w-8 h-8 text-green-500 mx-auto mb-3" />
            <h3 className="font-semibold text-text-primary mb-2">Real-time Discussion</h3>
            <p className="text-text-secondary text-sm">
              Get instant feedback and discuss market movements as they happen.
            </p>
          </div>

          <div className="bg-bg-tertiary border border-border-subtle rounded-lg p-6">
            <Clock className="w-8 h-8 text-purple-500 mx-auto mb-3" />
            <h3 className="font-semibold text-text-primary mb-2">24/7 Support</h3>
            <p className="text-text-secondary text-sm">
              Access community support and platform assistance around the clock.
            </p>
          </div>
        </div>

        <div className="mt-8 bg-blue-50 border border-blue-200 rounded-lg p-6">
          <h3 className="text-lg font-semibold text-blue-900 mb-2">Get Notified</h3>
          <p className="text-blue-700 mb-4">
            Want to be among the first to access the community chat when it launches?
          </p>
          <button className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 transition-colors">
            Join Waitlist
          </button>
        </div>
      </div>
    </div>
  );
};

export default Chat;
