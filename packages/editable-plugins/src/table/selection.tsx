import { Editable, useSlate } from "@editablejs/editor";
import { Path } from 'slate'
import React, { useState, useContext, useLayoutEffect, useMemo } from "react";
import { TableCellEditor, TableCellPoint } from "./cell";
import { TableContext, TableSelected, TableSelection } from "./context";
import { Table, TableEditor } from "./editor";

const prefixCls = 'editable-table';

export interface TableSelectionProps {
  editor: Editable
  table: Table
}

const TableSelectionDefault: React.FC<TableSelectionProps> = ({ editor, table }) => {
  const { selection } = useContext(TableContext)
  const [rect, setRect] = useState<DOMRect | null>(null)
  useLayoutEffect(() => {
    if(!selection) return setRect(null)
    const {start, end} = TableCellEditor.edges(selection)
    if(TableCellEditor.equal(start, end)) return setRect(null)
    const path = Editable.findPath(editor, table)
    const startCell = TableEditor.getCell(editor, path, start)
    if(!startCell) return setRect(null)
    const endCell = TableEditor.getCell(editor, path, end)
    if(!endCell) return setRect(null)
    const startEl = Editable.toDOMNode(editor, startCell[0])
    const endEl = Editable.toDOMNode(editor, endCell[0])
    const tableEl = Editable.toDOMNode(editor, table)
    const tableRect = tableEl.getBoundingClientRect()
    const startRect = startEl.getBoundingClientRect()
    const endRect = endEl.getBoundingClientRect()
    const width = endRect.left < startRect.left ? startRect.right - endRect.left : endRect.right - startRect.left
    const height = Math.max(endRect.bottom - startRect.top, startRect.height)
    const top = startRect.top - tableRect.top
    const left = Math.min(startRect.left - tableRect.left, endRect.left - tableRect.left)
    setRect(new DOMRect(left, top, width, height))
  }, [editor, selection, table])

  useLayoutEffect(() => {
    if(rect) {
      editor.clearSelectionDraw()
    } else {
      editor.startSelectionDraw()
    }
  }, [editor, rect])
  
  if(!rect) return null
  const { top, left, width, height } = rect
  return <div className={`${prefixCls}-selection`} style={{ left, top, width, height }} />
}

const TableSelection = React.memo(TableSelectionDefault, (prev, next) => {
  return prev.editor === next.editor && prev.table === next.table
})

const useSelection = (table: Table) => {
  // selection
  const [selection, setSelection] = useState<TableSelection | null>(null)
  const slateEditor = useSlate()
  useLayoutEffect(() => {
    const selection = TableEditor.getSelection(slateEditor, [table, Editable.findPath(slateEditor, table)])

    if(selection) {
      setSelection(prev => {
        if(!prev || !Path.equals(prev.start, selection.start) || !Path.equals(prev.end, selection.end)) {
          const path = Editable.findPath(slateEditor, table)
          const startPath = path.concat(selection.start)
          const endPath = path.concat(selection.end)
          const edgeSelection = TableEditor.edges(slateEditor, [table, path] , selection)
          const {start: tableStart, end: tableEnd} = TableEditor.span(slateEditor, [table, path], edgeSelection)
          const selStart = path.concat(tableStart)
          const selEnd = path.concat(tableEnd)
          // 有合并的单元格时选择区域会变大，所以需要重新select
          if(!Path.equals(startPath, selStart) || !Path.equals(endPath, selEnd)) { 
            TableEditor.select(slateEditor, [table, path], edgeSelection)
            return prev
          }
          return selection
        }
        return prev
      })
    } else {
      setSelection(null)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slateEditor, slateEditor.selection])    

  const selected: TableSelected = useMemo(() => {
    const {start, end} = selection ? TableEditor.edges(slateEditor, Editable.findPath(slateEditor, table), selection) : {start: [0, 0], end: [-1, -1]}
    const [startRow, startCol] = start
    const [endRow, endCol] = end
    const rows: number[] = []
    const cols: number[] = []
    const cells: TableCellPoint[] = []
    const tableRows = table.children.length
    const tableCols = table.colsWidth?.length ?? 0
    const rowFull = startCol === 0 && endCol === tableCols - 1
    const colFull = startRow === 0 && endRow === tableRows - 1
    for(let i = startRow; i <= endRow; i++) { 
      rows.push(i)
      for(let c = startCol; c <= endCol; c++) { 
        cells.push([i, c])
      }
    }
    for(let i = startCol; i <= endCol; i++) { 
      cols.push(i)
    }
    return {
      rows,
      cols,
      rowFull,
      colFull,
      allFull: rowFull && colFull,
      cells,
      count: cells.length
    }
  }, [slateEditor, selection, table])
  return {
    selection,
    selected
  }
}

export {
  TableSelection,
  useSelection
}