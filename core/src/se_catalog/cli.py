"""Local JSON CLI for the Node message adapter. No server or listening socket."""
import argparse
import json
import sys
from pathlib import Path
from . import codes
from .api import public_result, build_info
from .catalog.web import HoldBook, Spacer
from .names import trusted_chinese, _DATA


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('operation', choices=['lookup', 'names', 'codes', 'info', 'name-table'])
    parser.add_argument('values', nargs='*')
    parser.add_argument('--state-dir')
    parser.add_argument('--responses', help='Explicit offline HTTP-response fixture; never opens a network connection')
    args = parser.parse_args()
    try:
        if args.operation == 'info':
            result = build_info()
        elif args.operation == 'name-table':
            result = [[e['original'], e['chinese']] for e in _DATA['entries']]
        elif args.operation == 'names':
            result = [trusted_chinese(n) for n in args.values]
        elif args.operation == 'codes':
            result = {'canonical': [codes.canonical(n) for n in args.values],
                      'same_work': codes.same_work(*args.values[:2]) if len(args.values) >= 2 else None}
        else:
            request = json.load(sys.stdin)
            options = {'holds': HoldBook(Path(args.state_dir) if args.state_dir else None), 'spacer': Spacer()}
            if args.responses:
                from .testing import ResponseWeb
                options['web'] = ResponseWeb(Path(args.responses))
            result = public_result(str(request['code']), request.get('hints', []), **options)
        print(json.dumps(result, ensure_ascii=False))
    except Exception as error:
        print(json.dumps({'error': type(error).__name__}), file=sys.stderr)
        raise SystemExit(1)

if __name__ == '__main__':
    main()
