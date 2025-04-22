import * as React from "react";
import { cn } from "@/utils/cn";

interface TabsProps {
  defaultValue?: string;
  value?: string;
  onValueChange?: (value: string) => void;
  className?: string;
  children: React.ReactNode;
}

const Tabs = ({ defaultValue, value, onValueChange, className, children }: TabsProps) => {
  const [activeTab, setActiveTab] = React.useState(value || defaultValue || "");

  React.useEffect(() => {
    if (value !== undefined) {
      setActiveTab(value);
    }
  }, [value]);

  const handleTabChange = (tabValue: string) => {
    if (value === undefined) {
      setActiveTab(tabValue);
    }
    if (onValueChange) {
      onValueChange(tabValue);
    }
  };

  return (
    <div className={cn("w-full", className)}>
      {React.Children.map(children, (child) => {
        if (React.isValidElement(child) && child.type === TabsList) {
          return React.cloneElement(child as React.ReactElement<any>, {
            activeTab,
            onTabChange: handleTabChange,
          });
        }
        if (React.isValidElement(child) && child.type === TabsContent) {
          return React.cloneElement(child as React.ReactElement<any>, {
            activeTab,
          });
        }
        return child;
      })}
    </div>
  );
};

interface TabsListProps {
  className?: string;
  children: React.ReactNode;
  activeTab?: string;
  onTabChange?: (value: string) => void;
}

const TabsList = ({ className, children, activeTab, onTabChange }: TabsListProps) => {
  return (
    <div className={cn("flex border-b", className)}>
      {React.Children.map(children, (child) => {
        if (React.isValidElement(child) && child.type === TabsTrigger) {
          return React.cloneElement(child as React.ReactElement<any>, {
            active: activeTab === child.props.value,
            onSelect: () => onTabChange && onTabChange(child.props.value),
          });
        }
        return child;
      })}
    </div>
  );
};

interface TabsTriggerProps {
  className?: string;
  value: string;
  children: React.ReactNode;
  active?: boolean;
  onSelect?: () => void;
}

// Removed unused value parameter from the function parameters, keeping it in the interface
const TabsTrigger = ({ className, children, active, onSelect }: TabsTriggerProps) => {
  return (
    <button
      className={cn(
        "px-4 py-2 text-sm font-medium",
        active
          ? "border-b-2 border-primary text-primary"
          : "text-muted-foreground hover:text-foreground",
        className
      )}
      onClick={onSelect}
    >
      {children}
    </button>
  );
};

interface TabsContentProps {
  className?: string;
  value: string;
  children: React.ReactNode;
  activeTab?: string;
}

const TabsContent = ({ className, value, children, activeTab }: TabsContentProps) => {
  if (value !== activeTab) {
    return null;
  }

  return (
    <div className={cn("mt-4", className)}>
      {children}
    </div>
  );
};

export { Tabs, TabsList, TabsTrigger, TabsContent };
