#!/usr/bin/env python3
import json

def revert_to_example_com():
    """Revert all IRI examples back to https://example.com/"""
    
    # Load the OpenAPI spec
    with open('/Users/alex/api-docs/api-reference/openapi.json', 'r') as f:
        spec = json.load(f)
    
    def revert_iris_in_object(obj):
        """Recursively revert IRI examples to example.com"""
        if isinstance(obj, dict):
            for key, value in obj.items():
                if key == 'example' and isinstance(value, str):
                    # Revert API paths back to example.com
                    if value.startswith('/api/v1/'):
                        obj[key] = 'https://example.com/'
                
                elif isinstance(value, (dict, list)):
                    revert_iris_in_object(value)
        
        elif isinstance(obj, list):
            for item in obj:
                if isinstance(item, (dict, list)):
                    revert_iris_in_object(item)
    
    # Revert schemas
    schemas_updated = 0
    
    for schema_name, schema_def in spec.get('components', {}).get('schemas', {}).items():
        if schema_name.startswith('Error'):
            continue
        
        before = json.dumps(schema_def)
        revert_iris_in_object(schema_def)
        after = json.dumps(schema_def)
        
        if before != after:
            schemas_updated += 1
    
    # Revert path operations
    paths_updated = 0
    
    for path, methods in spec.get('paths', {}).items():
        for method, operation in methods.items():
            if 'responses' in operation or 'requestBody' in operation:
                before = json.dumps(operation.get('responses', {}))
                before += json.dumps(operation.get('requestBody', {}))
                
                if 'responses' in operation:
                    revert_iris_in_object(operation['responses'])
                if 'requestBody' in operation:
                    revert_iris_in_object(operation['requestBody'])
                
                after = json.dumps(operation.get('responses', {}))
                after += json.dumps(operation.get('requestBody', {}))
                
                if before != after:
                    paths_updated += 1
    
    # Save the updated spec
    with open('/Users/alex/api-docs/api-reference/openapi.json', 'w') as f:
        json.dump(spec, f, indent=2)
    
    print(f"✅ Reverted {schemas_updated} schemas back to https://example.com/")
    print(f"✅ Reverted {paths_updated} path operations")
    print(f"✅ All IRI examples now use https://example.com/ again")

if __name__ == "__main__":
    revert_to_example_com()