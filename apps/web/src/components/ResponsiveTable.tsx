import React from 'react';

interface ResponsiveTableProps {
  children: React.ReactNode;
  className?: string;
  caption?: string;
}

interface ResponsiveTableHeaderProps {
  children: React.ReactNode;
  className?: string;
}

interface ResponsiveTableRowProps {
  children: React.ReactNode;
  className?: string;
}

interface ResponsiveTableCellProps {
  children: React.ReactNode;
  className?: string;
  header?: boolean;
  hideOnMobile?: boolean;
  hideOnTablet?: boolean;
  label?: string; // For mobile stacked view
}

const ResponsiveTable: React.FC<ResponsiveTableProps> = ({ 
  children, 
  className = '',
  caption 
}) => {
  return (
    <div className="table-responsive">
      <table className={`w-full divide-y divide-neutral-200 ${className}`}>
        {caption && (
          <caption className="sr-only">
            {caption}
          </caption>
        )}
        {children}
      </table>
    </div>
  );
};

const ResponsiveTableHeader: React.FC<ResponsiveTableHeaderProps> = ({ 
  children, 
  className = '' 
}) => {
  return (
    <thead className={`bg-neutral-50 ${className}`}>
      {children}
    </thead>
  );
};

const ResponsiveTableRow: React.FC<ResponsiveTableRowProps> = ({ 
  children, 
  className = '' 
}) => {
  return (
    <tr className={`
      bg-white hover:bg-neutral-50 transition-colors
      mobile:block mobile:border mobile:border-neutral-200 mobile:rounded-lg mobile:mb-4 mobile:p-4
      ${className}
    `}>
      {children}
    </tr>
  );
};

const ResponsiveTableCell: React.FC<ResponsiveTableCellProps> = ({ 
  children, 
  className = '',
  header = false,
  hideOnMobile = false,
  hideOnTablet = false,
  label
}) => {
  const Tag = header ? 'th' : 'td';
  
  const hiddenClasses = [
    hideOnMobile && 'mobile:hidden',
    hideOnTablet && 'tablet:hidden'
  ].filter(Boolean).join(' ');

  return (
    <Tag className={`
      px-4 py-3 text-sm
      mobile:block mobile:border-0 mobile:px-0 mobile:py-1
      ${header 
        ? 'font-medium text-neutral-900 text-left mobile:hidden' 
        : 'text-neutral-500 mobile:text-neutral-900'
      }
      ${hiddenClasses}
      ${className}
    `}>
      {!header && label && (
        <span className="font-medium text-neutral-900 mr-2 hidden mobile:inline">
          {label}:
        </span>
      )}
      {children}
    </Tag>
  );
};

export { 
  ResponsiveTable, 
  ResponsiveTableHeader, 
  ResponsiveTableRow, 
  ResponsiveTableCell 
};