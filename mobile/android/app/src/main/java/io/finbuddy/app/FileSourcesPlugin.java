package io.finbuddy.app;

import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;

@CapacitorPlugin(name="FileSources")
public class FileSourcesPlugin extends Plugin {
    @PluginMethod public void pickFolder(PluginCall call) {
        Intent intent=new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION|Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
        startActivityForResult(call,intent,"folderPicked");
    }
    @ActivityCallback private void folderPicked(PluginCall call,ActivityResult result) {
        if(call==null)return;
        if(result.getResultCode()!=Activity.RESULT_OK||result.getData()==null){call.reject("Folder selection cancelled.");return;}
        try {Uri uri=result.getData().getData();getContext().getContentResolver().takePersistableUriPermission(uri,Intent.FLAG_GRANT_READ_URI_PERMISSION);JSObject response=new JSObject();response.put("token",uri.toString());response.put("label",DocumentsContract.getTreeDocumentId(uri).replaceFirst(".*:",""));call.resolve(response);}catch(Exception error){call.reject("Folder access could not be saved.",error);}
    }
    @PluginMethod public void listFiles(PluginCall call) {
        new Thread(()->{try {Uri root=Uri.parse(call.getString("token",""));JSArray files=new JSArray();walk(root,DocumentsContract.getTreeDocumentId(root),"",files,0);JSObject response=new JSObject();response.put("files",files);call.resolve(response);}catch(Exception error){call.reject("Folder access expired or the source is unavailable. Select it again.",error);}}).start();
    }
    private void walk(Uri root,String id,String prefix,JSArray files,int depth) throws Exception {
        if(depth>40||files.length()>1000)throw new Exception("Folder exceeds the safe scan limit.");
        String[] columns={DocumentsContract.Document.COLUMN_DOCUMENT_ID,DocumentsContract.Document.COLUMN_DISPLAY_NAME,DocumentsContract.Document.COLUMN_MIME_TYPE,DocumentsContract.Document.COLUMN_SIZE};
        try(Cursor cursor=getContext().getContentResolver().query(DocumentsContract.buildChildDocumentsUriUsingTree(root,id),columns,null,null,null)) {
            if(cursor==null)return;
            while(cursor.moveToNext()){String child=cursor.getString(0),name=cursor.getString(1),mime=cursor.getString(2),relative=prefix+name;
                if(name.startsWith(".")||name.equalsIgnoreCase("desktop.ini"))continue;
                if(DocumentsContract.Document.MIME_TYPE_DIR.equals(mime))walk(root,child,relative+"/",files,depth+1);
                else {JSObject file=new JSObject();file.put("path",relative);file.put("uri",DocumentsContract.buildDocumentUriUsingTree(root,child).toString());file.put("size",cursor.getLong(3));file.put("type",mime);files.put(file);}
            }
        }
    }
    @PluginMethod public void readFile(PluginCall call) {
        new Thread(()->{try {Uri uri=Uri.parse(call.getString("uri",""));ByteArrayOutputStream output=new ByteArrayOutputStream();try(InputStream input=getContext().getContentResolver().openInputStream(uri)){if(input==null)throw new Exception("Source is unreadable.");byte[] buffer=new byte[8192];int count;while((count=input.read(buffer))!=-1){if(output.size()+count>50*1024*1024)throw new Exception("File exceeds the 50 MB reader limit.");output.write(buffer,0,count);}}
            JSObject response=new JSObject();response.put("data",Base64.encodeToString(output.toByteArray(),Base64.NO_WRAP));call.resolve(response);
        }catch(Exception error){call.reject("Could not read the selected document: "+error.getMessage(),error);}}).start();
    }
}
