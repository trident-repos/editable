import EventEmitter from '@editablejs/event-emitter';
import { EVENT_NODE_UPDATE, OP_DELETE_NODE, OP_DELETE_TEXT } from '@editablejs/constants'
import { Log } from '@editablejs/utils'
import type { IModel, INode, IObjectMap, ModelOptions, NodeData, NodeKey, IElement, Op, NodeObject, NodeOptions } from "./types";
import Node from './node'
import Text from './text'
import Element from './element'
import ObjectMap from './map';
import diff from './diff';

export type ModelEventType = typeof EVENT_NODE_UPDATE

export const createNode = <T extends NodeData = NodeData, N extends INode<T> = INode<T>>(options: NodeOptions<T>): N => {
  if(Text.isTextObject(options)) return Text.create(options) as unknown as N
  else if(Element.isElementObject(options)) return Element.create(options) as unknown as N
  return Node.create(options) as unknown as N
}

Element.createChildNode = createNode
export default class Model extends EventEmitter<ModelEventType> implements IModel {
  
  protected options: ModelOptions
  protected map: IObjectMap = new ObjectMap()

  constructor(options?: ModelOptions) {
    super()
    this.options = options ?? {}
  }

  protected emitUpdate = (node: INode, ...ops: Op[]) => { 
    const deleteRootOp = ops.find(op => op.type === OP_DELETE_NODE && !op.key)
    if(deleteRootOp) {
      const roots = this.getRoots()
      const root = roots[deleteRootOp.offset]
      if(root) this.map.delete(root.getKey())
    } else {
      this.map.apply(node)
    }
    console.log(ops)
    this.emit(EVENT_NODE_UPDATE, node, ops)
  }

  getNode<T extends NodeData = NodeData, N extends INode<T> = INode<T>>(key: NodeKey): N | null{
    const obj = this.map.get(key)
    if(!obj) return null
    return createNode<T, N>(obj)
  }

  getNext<T extends NodeData = NodeData, N extends INode<T> = INode<T>>(key: NodeKey): N | null { 
    const obj = this.map.next(key)
    if(!obj) return null
    return createNode<T, N>(obj)
  }

  getPrev<T extends NodeData = NodeData, N extends INode<T> = INode<T>>(key: NodeKey): N | null { 
    const obj = this.map.prev(key)
    if(!obj) return null
    return createNode<T, N>(obj)
  }

  getRoots<T extends NodeData = NodeData>(){
    return this.map.roots<T>().map(root => Element.create<T>(root))
  }

  getRootKeys(){ 
    return this.map.rootKeys()
  }

  filter<T extends NodeData = NodeData, N extends INode<T> = INode<T>>(callback: (obj: NodeObject<T>) => boolean): N[] { 
    return this.map.filter<T>(callback).map(obj => createNode<T, N>(obj))
  }

  applyNode(node: INode, callback?: (ops: Op[]) => void){ 
    const key = node.getKey()
    const parentKey = node.getParentKey()
    const oldNode = this.getNode(key)
    let ops: Op[] = []
    if(oldNode) { 
      ops = diff([node], [oldNode])
    } else if(parentKey) {
      const parent = this.getNode(parentKey)
      if(!parent) Log.nodeNotFound(parentKey)
      if(!Element.isElement(parent)) Log.nodeNotElement(parentKey)
      const children = parent.getChildren()
      ops = diff([...children, node], children)
    } else {
      const roots = this.getRoots()
      ops = diff([ ...roots, node ], roots)
    }
    if(callback) callback(ops)
    if(ops.length > 0) this.emitUpdate(node, ...ops)
  }

  applyOps(...ops: Op[]){ 
    // TODO
  }

  insertText(text: string, key: NodeKey, offset?: number ){
    const node = this.getNode(key)
    if(!node) Log.nodeNotFound(key)
    if(Element.isElement(node)) {
      const size = node.getChildrenSize()
      if(offset === undefined) offset = size
      if(size < 0 || size < offset) Log.offsetOutOfRange(key, offset)
      const textNode = Text.create({ text })
      this.insertNode(textNode, key, offset);
    } else if(Text.isText(node)) {
      node.insert(text, offset)
      this.applyNode(node)
    }
  }

  deleteText(key: NodeKey, offset: number, length: number){ 
    const node = this.getNode(key)
    if(!node) Log.nodeNotFound(key)
    if(!Text.isText(node)) Log.nodeNotText(key)
    node.delete(offset, length)
    this.applyNode(node, ops => {
      const deleteOp = ops.find(op => op.type === OP_DELETE_TEXT && op.key === key)
      // 在多个相同字符间删除后无法获取到正确的索引 aaa<cursor />a -> offset: 4，修正为 offset: 3
      if(deleteOp && deleteOp.offset > offset) {
        deleteOp.offset = offset
      }
    })
  }

  insertNode(node: INode, key?: NodeKey, offset?: number){ 
    // insert to roots
    if(!key) {
      if(Text.isText(node)) Log.cannotInsertText('root')
      this.applyNode(node)
      return 
    }
    const nodeKey = node.getKey()
    if(this.getNode(nodeKey)) {
      Log.nodeAlreadyExists(nodeKey)
    }
    const targetNode = this.getNode(key);
    if(!targetNode) Log.nodeNotFound(key)
    const parentKey = targetNode.getParentKey()
    if(!parentKey) Log.nodeNotInContext(key)
    let parent = this.getNode<NodeData, IElement>(parentKey)
    if(!parent) Log.nodeNotFound(parentKey)
    if(Text.isText(targetNode)) {
      offset = offset ?? targetNode.getText().length
      if(Text.isText(node) && targetNode.compare(node)) {
        const text = node.getText()
        targetNode.insert(text, offset)
        this.applyNode(targetNode)
        return
      }
    }
    else if(Element.isElement(targetNode)) {
      const size = targetNode.getChildrenSize()
      if(offset === undefined) offset = size
    } else return
    parent = this.splitNode(key, offset, (left, right) => [left, right].filter(child => !child.isEmpty()))
    const index = parent.indexOf(key)
    parent.insert(index + 1, node)
    this.applyNode(parent)
  }

  splitNode(key: NodeKey, offset: number, callback: (left: INode, right: INode) => INode[] = (left, right) => [left, right]){
    const node = this.getNode(key);
    if(!node) Log.nodeNotFound(key)
    const parentKey: string | null = node.getParentKey()
    if(!parentKey) Log.nodeNotInContext(key)
    const parent: INode | null = this.getNode(parentKey)
    if(!parent) Log.nodeNotFound(parentKey)
    if(!Element.isElement(parent)) Log.nodeNotElement(parentKey)
    const children = parent.getChildren()
    const index = children.findIndex(child => child.getKey() === key)
    if(Text.isText(node)) {
      if(offset < 0 || offset > node.getText().length) Log.offsetOutOfRange(key, offset)
      const [ leftText, rightText ] = node.split(offset)
      parent.removeChild(key)
      parent.insert(index, ...callback(leftText, rightText)) 
    }
    else if(Element.isElement(node)) {
      if(offset < 0 || offset > node.getChildrenSize()) Log.offsetOutOfRange(key, offset)
      const [ leftNode, rightNode ] = node.split(offset) 
      parent.removeChild(key)
      parent.insert(index, ...callback(leftNode, rightNode))
    }
    this.applyNode(parent)
    return this.getNode<any, IElement>(parentKey) ?? Element.create(parent.toJSON())
  }

  deleteNode(key: NodeKey){
    const node = this.getNode(key);
    if(!node) Log.nodeNotFound(key)
    const parentKey = node.getParentKey()
    if(parentKey) {
      const parent = this.getNode(parentKey)
      if(!parent) Log.nodeNotFound(parentKey)
      if(!Element.isElement(parent)) Log.nodeNotElement(parentKey)
      parent.removeChild(key)
      this.applyNode(parent)
    } else {
      const roots = this.getRoots()
      const ops = diff(roots.filter(root => root.getKey() !== key), roots)
      this.emitUpdate(node, ...ops)
    }
  }

  destroy(){
    this.map.clear()
  }
}

export * from "./types";
export {
  Node,
  Text,
  Element
}